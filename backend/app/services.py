
from PIL import Image, ExifTags
import numpy as np


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def percent_change(before, after):
    if before in (None, 0):
        if after in (None, 0):
            return 0.0
        return 100.0
    return ((after - before) / abs(before)) * 100.0


def outcome_score(x):
    ndvi_gain = min(max((x["after_ndvi"] - x["before_ndvi"]) * 100, 0), 35)
    water_gain = min(max((x["after_water_ha"] - x["before_water_ha"]) * 20, 0), 35)
    photo_bonus = 10 if x.get("photo_verified") else 0
    return min(100, round(40 + ndvi_gain + water_gain + photo_bonus))


def rainfall_context_for(item):
    seed = sum(ord(ch) for ch in str(item.get("id", ""))) % 160
    baseline = 860 + (sum(ord(ch) for ch in str(item.get("type", ""))) % 40)
    current = baseline - 18 + seed
    variation_pct = round(((current - baseline) / baseline) * 100, 1)
    if abs(variation_pct) <= 5:
        status = "NORMAL"
    elif variation_pct > 0:
        status = "WET"
    else:
        status = "DRY"
    return {
        "current_mm": int(round(current)),
        "historical_average_mm": int(round(baseline)),
        "variation_pct": variation_pct,
        "status": status,
        "note": "Prototype rainfall context derived from the intervention's deterministic seasonal baseline.",
    }


def calculate_impact_score(item, rainfall_context=None):
    water_change_pct = round(percent_change(item.get("before_water_ha", 0), item.get("after_water_ha", 0)), 1)
    vegetation_change_pct = round(percent_change(item.get("before_ndvi", 0), item.get("after_ndvi", 0)), 1)
    rainfall = rainfall_context or rainfall_context_for(item)
    rainfall_variation = abs(rainfall.get("variation_pct", 0.0))

    water_component = round(clamp((water_change_pct / 25.0) * 30.0, 0, 30))
    vegetation_component = round(clamp((vegetation_change_pct / 20.0) * 25.0, 0, 25))
    land_component = round(clamp(8 + max(0, vegetation_change_pct) * 0.2 + max(0, water_change_pct) * 0.18 + (8 if item.get("photo_verified") else 2), 0, 20))
    intervention_component = 12 if item.get("photo_verified") else 7
    rainfall_component = 9 if rainfall.get("status") == "NORMAL" else 6 if rainfall.get("status") == "WET" else 5
    score = clamp(water_component + vegetation_component + land_component + intervention_component + rainfall_component, 0, 100)

    details = {
        "water_improvement": water_component,
        "vegetation_improvement": vegetation_component,
        "land_condition": land_component,
        "intervention_condition": intervention_component,
        "rainfall_context": rainfall_component,
        "total": score,
    }
    return {
        "score": score,
        "components": {
            "Water Improvement": {"score": water_component, "max": 30, "label": "Water Improvement"},
            "Vegetation Improvement": {"score": vegetation_component, "max": 25, "label": "Vegetation Improvement"},
            "Land/Environmental Condition": {"score": land_component, "max": 20, "label": "Land/Environmental Condition"},
            "Intervention Condition": {"score": intervention_component, "max": 15, "label": "Intervention Condition"},
            "Rainfall Context": {"score": rainfall_component, "max": 10, "label": "Rainfall Context"},
        },
        "breakdown_total": 100,
        "water_change_pct": water_change_pct,
        "vegetation_change_pct": vegetation_change_pct,
        "rainfall_variation_pct": rainfall_variation,
        "explanation": build_impact_explanation(item, water_change_pct, vegetation_change_pct, rainfall, item.get("photo_verified", False)),
    }


def build_impact_explanation(item, water_change_pct, vegetation_change_pct, rainfall_context, photo_verified):
    explanations = []
    if water_change_pct > 0:
        explanations.append(f"+ Water area increased by {water_change_pct:.1f}%")
    elif water_change_pct < 0:
        explanations.append(f"- Water area decreased by {abs(water_change_pct):.1f}%")
    else:
        explanations.append("+ Water area remained stable")

    if vegetation_change_pct > 0:
        explanations.append(f"+ Vegetation increased by {vegetation_change_pct:.1f}%")
    elif vegetation_change_pct < 0:
        explanations.append(f"- Vegetation declined by {abs(vegetation_change_pct):.1f}%")
    else:
        explanations.append("+ Vegetation remained stable")

    if photo_verified:
        explanations.append("+ Intervention condition is satisfactory")
    else:
        explanations.append("- Intervention condition needs field validation")

    if rainfall_context and rainfall_context.get("status") == "NORMAL":
        explanations.append("+ Rainfall is close to the seasonal baseline")
    elif rainfall_context and rainfall_context.get("status") == "WET":
        explanations.append("+ Rainfall is above the seasonal baseline and should be interpreted with caution")
    else:
        explanations.append("- Rainfall is below the seasonal baseline")

    if water_change_pct < -20:
        explanations.append("- Minor sedimentation or structural stress detected")
    elif vegetation_change_pct < -5:
        explanations.append("- Vegetation stress may need inspection")
    return explanations


def detect_anomaly(item, rainfall_context=None):
    rainfall = rainfall_context or rainfall_context_for(item)
    water_change_pct = percent_change(item.get("before_water_ha", 0), item.get("after_water_ha", 0))
    vegetation_change_pct = percent_change(item.get("before_ndvi", 0), item.get("after_ndvi", 0))
    reasons = []
    severity = "LOW"

    if water_change_pct < -20:
        reasons.append("Water area declined sharply compared with the previous observation.")
        severity = "HIGH"
    if vegetation_change_pct < -10:
        reasons.append("Unexpected vegetation loss was observed in the current field condition.")
        severity = "HIGH" if severity == "HIGH" else "MEDIUM"
    if not item.get("photo_verified"):
        reasons.append("Recent evidence is missing or the site has not been photo-validated.")
        severity = "HIGH" if severity == "HIGH" else "MEDIUM"
    if not reasons:
        return {
            "status": "NO ANOMALY",
            "severity": "LOW",
            "confidence": 0,
            "reasons": ["The intervention is behaving within the expected prototype range."],
            "priority": "LOW",
            "recommended_action": "Continue monitoring and routine checks.",
        }

    confidence = clamp(62 + abs(water_change_pct) * 0.7 + abs(vegetation_change_pct) * 0.4 + (8 if not item.get("photo_verified") else 0), 65, 92)
    return {
        "status": "ANOMALY DETECTED",
        "severity": severity,
        "confidence": round(confidence),
        "reasons": reasons,
        "priority": "HIGH" if severity == "HIGH" else "MEDIUM",
        "recommended_action": "Field verification required.",
        "rainfall_status": rainfall.get("status", "NORMAL"),
        "water_change_pct": round(water_change_pct, 1),
        "vegetation_change_pct": round(vegetation_change_pct, 1),
    }


def intervention_specific_analysis(item):
    item_type = item.get("type", "Unknown")
    focus_by_type = {
        "Check Dam": [
            "water retention",
            "water spread",
            "structural condition",
            "sedimentation",
            "nearby vegetation",
        ],
        "Farm Pond": [
            "water presence",
            "water spread",
            "seasonal persistence",
            "surrounding vegetation",
        ],
        "Plantation": [
            "vegetation density",
            "vegetation change",
            "canopy growth",
            "survival indicator",
        ],
        "Bund": [
            "vegetation recovery",
            "erosion indicator",
            "structural condition",
            "runoff control",
        ],
    }
    focus = focus_by_type.get(item_type, ["condition review", "evidence validation", "field observation"])
    performance = round(clamp((item.get("after_ndvi", 0) - item.get("before_ndvi", 0)) * 100 + (item.get("after_water_ha", 0) - item.get("before_water_ha", 0)) * 3, 0, 100), 1)
    return {
        "type": item_type,
        "focus_areas": focus,
        "condition_score": performance,
        "note": f"Prototype assessment for {item_type} based on watershed evidence and field condition indicators.",
    }


def generate_report(item, watershed, impact, rainfall, anomaly, evidence_count=0):
    water_change = impact.get("water_change_pct", 0)
    vegetation_change = impact.get("vegetation_change_pct", 0)
    return {
        "report_title": "JAL-DRISHTI | Watershed Monitoring Report",
        "watershed": watershed.get("name", "Unknown Watershed"),
        "area_ha": watershed.get("area_ha", 0),
        "interventions": [item.get("name", "Unknown Intervention")],
        "images": evidence_count,
        "impact_score": impact.get("score", 0),
        "water_change_pct": water_change,
        "vegetation_change_pct": vegetation_change,
        "rainfall_context": rainfall,
        "alerts": [anomaly.get("status", "NO ANOMALY")],
        "priority_inspections": [anomaly.get("recommended_action", "Continue monitoring")],
        "recommendations": impact.get("explanation", [])[:4],
    }


def extract_exif(img):
    out = {
        "gps_available": False,
        "timestamp": None,
        "camera": None,
        "latitude": None,
        "longitude": None,
    }
    try:
        raw = img.getexif()
        named = {ExifTags.TAGS.get(k, k): v for k, v in raw.items()}
        out["timestamp"] = named.get("DateTimeOriginal") or named.get("DateTime")
        out["camera"] = " ".join(
            str(x) for x in [named.get("Make"), named.get("Model")] if x
        ) or None

        gps = raw.get(34853)
        if gps:
            g = {ExifTags.GPSTAGS.get(k, k): v for k, v in gps.items()}

            def d(v):
                return float(v[0]) / float(v[1])

            required = ("GPSLatitude", "GPSLongitude", "GPSLatitudeRef", "GPSLongitudeRef")
            if all(k in g for k in required):
                lat = d(g["GPSLatitude"][0]) + d(g["GPSLatitude"][1]) / 60 + d(g["GPSLatitude"][2]) / 3600
                lon = d(g["GPSLongitude"][0]) + d(g["GPSLongitude"][1]) / 60 + d(g["GPSLongitude"][2]) / 3600
                if g["GPSLatitudeRef"] == "S":
                    lat = -lat
                if g["GPSLongitudeRef"] == "W":
                    lon = -lon
                out.update(
                    gps_available=True,
                    latitude=round(lat, 6),
                    longitude=round(lon, 6),
                )
    except Exception:
        pass
    return out


def quality_check(img):
    arr = np.asarray(img.convert("RGB").resize((256, 256))).astype(float)
    brightness = float(arr.mean())
    variance = float(arr.mean(axis=2).var())
    reasons = []
    if min(img.size) < 720:
        reasons.append("Image resolution is low")
    if variance <= 250:
        reasons.append("Image appears blurry")
    if brightness < 45:
        reasons.append("Image is too dark")
    elif brightness > 215:
        reasons.append("Image is too bright")
    status = "poor" if len(reasons) >= 2 or min(img.size) < 400 else "acceptable" if reasons else "good"
    return {
        "status": status,
        "brightness": round(brightness, 1),
        "sharpness_proxy": round(variance, 1),
        "resolution": {"width": img.width, "height": img.height},
        "reasons": reasons or ["Resolution sufficient", "Image readable", "Blur within acceptable range", "Brightness acceptable"],
        "note": "Prototype photo-quality validation; not professional forensic analysis.",
    }


def classify_demo(img):
    arr = np.asarray(img.convert("RGB").resize((128, 128))).astype(float)
    red, green, blue = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    vegetation_mask = (green > red * 1.08) & (green > blue * 1.02)
    water_mask = (blue > red * 1.12) & (blue > green * 0.92)
    vegetation_ratio = float(vegetation_mask.mean())
    water_ratio = float(water_mask.mean())
    brightness = float(arr.mean())

    if vegetation_ratio >= 0.28:
        label = "Vegetation / Watershed Scene"
        confidence = min(0.97, 0.62 + vegetation_ratio * 0.7)
    elif water_ratio >= 0.22:
        label = "Water Body / Wetland Evidence"
        confidence = min(0.94, 0.60 + water_ratio * 0.8)
    else:
        label = "Built / Bare Land Evidence"
        confidence = min(0.90, 0.55 + abs(0.5 - vegetation_ratio) * 0.5)

    return {
        "label": label,
        "confidence": round(confidence, 2),
        "mode": "explainable-pixel-baseline",
        "vegetation_ratio": round(vegetation_ratio, 3),
        "water_ratio": round(water_ratio, 3),
        "brightness": round(brightness, 1),
        "note": "Baseline for review; replace with a trained field dataset model for production.",
    }


def gis_analysis(x):
    return {
        "ndvi_change": round(x["after_ndvi"] - x["before_ndvi"], 3),
        "water_change_ha": round(x["after_water_ha"] - x["before_water_ha"], 2),
        "method": "Demo temporal spatial indicators",
        "production_note": "Use Sentinel-2/Landsat + DEM + rainfall normalization + field validation.",
    }


def image_analysis(x):
    return {
        "enabled": True,
        "predicted_class": x.get("type", "Unknown"),
        "confidence": 0.91 if x.get("photo_verified") else 0.68,
        "checks": {
            "image_quality": "pass",
            "geo_evidence": "available",
            "duplicate_check": "demo",
        },
    }
