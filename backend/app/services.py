
from PIL import Image, ExifTags
import numpy as np

def outcome_score(x):
    ndvi_gain = min(max((x["after_ndvi"] - x["before_ndvi"]) * 100, 0), 35)
    water_gain = min(max((x["after_water_ha"] - x["before_water_ha"]) * 20, 0), 35)
    photo_bonus = 10 if x.get("photo_verified") else 0
    return min(100, round(40 + ndvi_gain + water_gain + photo_bonus))

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
                lat = d(g["GPSLatitude"][0]) + d(g["GPSLatitude"][1])/60 + d(g["GPSLatitude"][2])/3600
                lon = d(g["GPSLongitude"][0]) + d(g["GPSLongitude"][1])/60 + d(g["GPSLongitude"][2])/3600
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
    return {
        "status": "good" if 45 <= brightness <= 215 and variance > 250 else "review",
        "brightness": round(brightness, 1),
        "sharpness_proxy": round(variance, 1),
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
