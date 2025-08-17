import math, json, pathlib
from rapidfuzz import process, fuzz  # pip install rapidfuzz
import sys, os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
from flask import Flask, request, jsonify
from flask_cors import CORS
from schemas import PredictRequest, PredictResponse
from utils import average, decision_label, recommendations

from models import UnimatchDummyModel
from llm_scorer import LLMScorer

load_dotenv()

app = Flask(__name__)
CORS(app)

# -------------------------------------------------------
# Engine switcher
# -------------------------------------------------------
USE_LLM = os.getenv("USE_LLM", "1") not in {"0", "false", "False"}
llm = LLMScorer() if USE_LLM else None
dummy = UnimatchDummyModel()

# -------------------------------------------------------
# Health / KB APIs
# -------------------------------------------------------
@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "name": "unimatch-ai",
        "version": "0.4.0",
        "llm_enabled": bool(llm and llm.client) if USE_LLM else False,
    }

@app.get("/api/kb/stats")
def kb_stats():
    if not llm:
        return {"llm_enabled": False}
    return {
        "llm_enabled": bool(llm.client),
        "majors_count": len(llm.kb.majors) if llm.kb and llm.kb.majors else 0,
        "distros_keys": list(llm.kb.distros.keys()) if llm.kb and llm.kb.distros else [],
        "calibrator_loaded": llm.calibrator.loaded if llm else False,
    }

@app.get("/api/kb/universities")
def kb_universities():
    """Return unique university names."""
    def _load():
        if llm and getattr(llm, "kb", None) and llm.kb.majors:
            return llm.kb.majors
        p = pathlib.Path(__file__).resolve().parents[1] / "kb" / "majors.json"
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}
    
    majors = _load()
    universities = sorted({ (v.get("university") or "").strip() for v in majors.values() if v.get("university") })
    return jsonify({"universities": universities, "count": len(universities)})

@app.get("/api/kb/majors")
def kb_majors():
    """Return unique major names (untuk multi-select)."""
    def _load():
        if llm and getattr(llm, "kb", None) and llm.kb.majors:
            return llm.kb.majors
        p = pathlib.Path(__file__).resolve().parents[1] / "kb" / "majors.json"
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}
    majors = _load()
    names = sorted({ (v.get("major") or "").strip() for v in majors.values() if v.get("major") })
    return jsonify({"majors": names, "count": len(names)})

@app.get("/api/kb/universities/<university_name>/majors")
def kb_university_majors(university_name):
    """Return majors available at a specific university."""
    def _load():
        if llm and getattr(llm, "kb", None) and llm.kb.majors:
            return llm.kb.majors
        p = pathlib.Path(__file__).resolve().parents[1] / "kb" / "majors.json"
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}
    
    majors = _load()
    university_majors = []
    
    for key, value in majors.items():
        if value.get("university") and value.get("major"):
            # Case-insensitive comparison
            if value["university"].lower() == university_name.lower():
                university_majors.append(value["major"])
    
    # Remove duplicates and sort
    university_majors = sorted(list(set(university_majors)))
    
    return jsonify({
        "university": university_name,
        "majors": university_majors, 
        "count": len(university_majors)
    })

# -------------------------------------------------------
# Helpers (recommender)
# -------------------------------------------------------
def _load_kb_majors(llm_obj):
    if llm_obj and getattr(llm_obj, "kb", None) and llm_obj.kb.majors:
        return llm_obj.kb.majors
    kb_path = (pathlib.Path(__file__).resolve().parents[1] / "kb" / "majors.json")
    if kb_path.exists():
        with open(kb_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

def _guess_program_from_major(name: str) -> str:
    s = (name or "").lower()
    saintek_kw = ["fisika","kimia","biologi","kedokteran","informatika","statistika","elektro","mesin","teknik","matematika","farmasi","geologi","perikanan","arsitektur","kehutanan","pertanian"]
    soshum_kw  = ["hukum","ekonomi","manajemen","akuntansi","psikologi","sosiologi","sejarah","ilmu","komunikasi","bahasa","pendidikan","administrasi","hubungan","politik","pariwisata","bisnis"]
    if any(k in s for k in saintek_kw): return "saintek"
    if any(k in s for k in soshum_kw):  return "soshum"
    return "unknown"

def _bucket_from_prob(p: float) -> str:
    if p >= 0.70: return "safe"
    if p >= 0.40: return "target"
    return "reach"

def _score_components(features, card):
    """Hitung probabilitas + komponen + tags penjelas."""
    rapor = float(features.get("rapor_avg", 0))
    core  = float(features.get("core_avg", rapor))
    rank  = int(features.get("rank_percentile", 100)) if features.get("rank_percentile") is not None else 100
    ach   = str(features.get("achievement", "none")).lower()
    akr   = str(features.get("accreditation", "B")).upper()

    rank_bonus = 3 if rank <= 10 else 2 if rank <= 20 else 1 if rank <= 40 else 0
    ach_bonus  = {"none":0,"school":1,"prov":3,"national":5}.get(ach,0)
    akr_adj    = {"A":1,"B":0,"C":-1}.get(akr,0)

    comp = (card.get("competitiveness") or features.get("competitiveness") or "high")
    ci   = card.get("ci")
    comp_pen = round(5*float(ci)) if isinstance(ci,(int,float)) else {"very":5,"high":3,"mid":1,"low":0}.get(str(comp).lower(),3)

    base = 0.6*rapor + 0.4*core
    score = base + rank_bonus + ach_bonus + akr_adj - comp_pen
    prob  = 1/(1+math.exp(-0.25*(score-75)))

    tags = []
    if rank <= 10: tags.append("Top-10% rank")
    elif rank <= 20: tags.append("Top-20% rank")
    if ach in {"prov","national"}: tags.append("Strong achievements")
    if akr == "A": tags.append("School A")
    if comp_pen <= 1: tags.append("Low competition")
    elif comp_pen >= 5: tags.append("Very competitive")

    components = {
        "base": round(base,2),
        "bonuses": {"rank_bonus": rank_bonus, "achievement_bonus": ach_bonus, "accreditation_adj": akr_adj},
        "penalties": {"competitiveness": comp_pen},
        "score": round(score,2)
    }
    return float(prob), components, tags

def _top_per_university(items, per_uni=2):
    """Ambil maksimum N prodi per universitas untuk diversity."""
    by = {}
    for it in items:
        by.setdefault(it["university"], []).append(it)
    out = []
    for uni, lst in by.items():
        lst.sort(key=lambda x: x["probability"], reverse=True)
        out.extend(lst[:per_uni])
    return out

def _find_best_match_for_university_major_pair(majors_kb, target_university, target_major):
    """
    Find the best matching entry in KB for a given university-major pair.
    Returns the key and card data, or (None, None) if no good match found.
    """
    if not target_university or not target_major:
        return None, None
    
    # First, try exact match
    for key, card in majors_kb.items():
        if (card.get("university", "").lower() == target_university.lower() and 
            card.get("major", "").lower() == target_major.lower()):
            return key, card
    
    # If no exact match, try fuzzy matching on university first
    university_matches = []
    for key, card in majors_kb.items():
        if card.get("university"):
            university_matches.append((key, card["university"]))
    
    if university_matches:
        uni_keys = [k for k, _ in university_matches]
        uni_names = [u for _, u in university_matches]
        
        # Fuzzy match university
        uni_result = process.extractOne(target_university, uni_names, scorer=fuzz.WRatio)
        if uni_result and uni_result[1] >= 70:  # 70% similarity threshold
            matched_uni_name = uni_result[0]
            
            # Now find majors in that university
            uni_majors = []
            for key, card in majors_kb.items():
                if card.get("university", "").lower() == matched_uni_name.lower():
                    if card.get("major"):
                        uni_majors.append((key, card["major"]))
            
            if uni_majors:
                major_keys = [k for k, _ in uni_majors]
                major_names = [m for _, m in uni_majors]
                
                # Fuzzy match major within that university
                major_result = process.extractOne(target_major, major_names, scorer=fuzz.WRatio)
                if major_result and major_result[1] >= 70:  # 70% similarity threshold
                    matched_major_name = major_result[0]
                    
                    # Find the exact entry
                    for key, card in majors_kb.items():
                        if (card.get("university", "").lower() == matched_uni_name.lower() and 
                            card.get("major", "").lower() == matched_major_name.lower()):
                            return key, card
    
    return None, None

# -------------------------------------------------------
# Predict
# -------------------------------------------------------
@app.post("/api/predict")
def predict():
    try:
        raw = request.get_json(force=True, silent=False)
        
        # Handle both old and new payload formats
        # Priority: target_university_1 + target_major_1 > target_major (legacy)
        if raw.get("target_university_1") and raw.get("target_major_1"):
            raw["target_university"] = raw["target_university_1"]
            raw["target_major"] = raw["target_major_1"]
        elif not raw.get("target_major") and isinstance(raw.get("target_majors"), list) and raw["target_majors"]:
            raw["target_major"] = raw["target_majors"][0]
            
        req = PredictRequest(**raw)
    except Exception as e:
        return jsonify({"error": f"Invalid payload: {e}"}), 400

    rapor_avg = average([req.s1, req.s2, req.s3, req.s4, req.s5]) or 0.0
    if req.program == "saintek":
        core_avg = average([req.math, req.language, req.physics, req.chemistry, req.biology])
    else:
        core_avg = average([req.math, req.language, req.economics, req.geography, req.history])
    core_avg = core_avg if core_avg is not None else rapor_avg

    features = {
        "program": req.program,
        "target_major": req.target_major,
        "target_university": getattr(req, 'target_university', None),
        "competitiveness": req.competitiveness,
        "rapor_avg": rapor_avg,
        "core_avg": core_avg,
        "rank_percentile": req.rank_percentile,
        "achievement": req.achievement,
        "accreditation": req.accreditation,
    }

    # Try to find specific university-major combination for better prediction
    target_university = getattr(req, 'target_university', None)
    target_major = req.target_major
    
    if llm and llm.client:
        # For LLM scoring, try to find the specific university-major match
        majors_kb = _load_kb_majors(llm)
        matched_key, matched_card = _find_best_match_for_university_major_pair(
            majors_kb, target_university, target_major
        )
        
        if matched_card:
            # Use the specific university-major combination
            result = llm.score(features, f"{matched_card.get('university', '')} - {matched_card.get('major', '')}")
        else:
            # Fallback to major-only scoring
            result = llm.score(features, req.target_major or "Unknown")
            
        prob = float(result.get("probability", 0.0))
        label = decision_label(prob)
        details = {
            **features,
            "probability_raw": result.get("probability_raw"),
            "program_match": result.get("program_match"),
            "matched_university_major": f"{matched_card.get('university', 'N/A')} - {matched_card.get('major', 'N/A')}" if matched_card else None,
        }
        tips = recommendations(prob, {
            **features,
            "competitiveness_penalty": {"very": 5, "high": 3, "mid": 1, "low": 0}[req.competitiveness]
        })
        return jsonify({
            "probability": prob,
            "label": label,
            "details": details,
            "tips": tips,
            "weights": result.get("weights"),
            "explanation": result.get("explanation", "")
        })

    # Dummy model fallback
    prob = dummy.predict_proba(features)
    label = decision_label(prob)
    details = {**features, "probability": prob, "label": label}
    tips = recommendations(prob, {**features, "competitiveness_penalty": {"very":5,"high":3,"mid":1,"low":0}[req.competitiveness]})
    resp = PredictResponse(probability=prob, label=label, details=details, tips=tips)
    return jsonify(resp.model_dump())

# -------------------------------------------------------
# Recommend (multi-major) -> preferred + alternatives
# -------------------------------------------------------
@app.post("/api/recommend")
def recommend():
    """
    Payload: sama spt /api/predict + optional target_majors/target_universities
    Query:   pref_n, alt_n, per_uni (default 10,10,2)
    """
    try:
        raw = request.get_json(force=True, silent=False)
        
        # Handle university-major pairs
        target_universities = []
        target_majors = []
        
        if isinstance(raw.get("target_universities"), list):
            target_universities = [str(x).strip() for x in raw.get("target_universities") if str(x).strip()]
        if isinstance(raw.get("target_majors"), list):
            target_majors = [str(x).strip() for x in raw.get("target_majors") if str(x).strip()]
            
        # Legacy support
        if not raw.get("target_major") and target_majors:
            raw["target_major"] = target_majors[0]
        if not raw.get("target_university") and target_universities:
            raw["target_university"] = target_universities[0]
            
        req = PredictRequest(**raw)
    except Exception as e:
        return jsonify({"error": f"Invalid payload: {e}"}), 400

    rapor_avg = average([req.s1, req.s2, req.s3, req.s4, req.s5]) or 0.0
    if req.program == "saintek":
        core_avg = average([req.math, req.language, req.physics, req.chemistry, req.biology])
    else:
        core_avg = average([req.math, req.language, req.economics, req.geography, req.history])
    core_avg = core_avg if core_avg is not None else rapor_avg

    feats = {
        "program": req.program,
        "target_major": req.target_major,
        "target_university": getattr(req, 'target_university', None),
        "competitiveness": req.competitiveness,
        "rapor_avg": rapor_avg,
        "core_avg": core_avg,
        "rank_percentile": req.rank_percentile,
        "achievement": req.achievement,
        "accreditation": req.accreditation,
    }

    majors = _load_kb_majors(llm)
    if not majors:
        return jsonify({"error": "Knowledge base not found. Run build_kb.py first."}), 500

    # Pool kandidat (filter kasar by program)
    pool = []
    for key, card in majors.items():
        prog_guess = _guess_program_from_major(card.get("major",""))
        if req.program in {"saintek","soshum"} and prog_guess not in {"unknown", req.program}:
            continue
        pool.append((key, card))

    # Fungsi untuk membuat item dengan skor & komponen
    def _item(key, card):
        p, comps, tags = _score_components(feats, card)
        return {
            "key": key,
            "university": card.get("university"),
            "major": card.get("major"),
            "level": card.get("level"),
            "sheet": card.get("sheet"),
            "ci": card.get("ci"),
            "competitiveness": card.get("competitiveness"),
            "probability": p,
            "bucket": _bucket_from_prob(p),
            "tags": tags,
            "components": comps,
            "label": decision_label(p),
        }

    # Preferred: match university-major pairs atau fuzzy match target_majors
    preferred = []
    
    # Try to match university-major pairs first
    if target_universities and target_majors:
        # Match pairs based on position (university[0] with major[0], etc.)
        pairs = list(zip(target_universities, target_majors))
        keep = set()
        
        for target_uni, target_maj in pairs:
            matched_key, matched_card = _find_best_match_for_university_major_pair(
                dict(pool), target_uni, target_maj
            )
            if matched_key:
                keep.add(matched_key)
        
        preferred = [_item(k, majors[k]) for k in keep if k in majors]
    
    # Fallback to major-only matching if no university-major pairs matched
    if not preferred and target_majors:
        keys = [k for k,_ in pool]
        keep = set()
        for query in target_majors:
            for (match, score, _) in process.extract(query, keys, scorer=fuzz.WRatio, limit=80):
                if score >= 80:
                    keep.add(match)
        preferred = [_item(k, majors[k]) for k in keep]

    # Others: selain preferred
    pref_keys = {x["key"] for x in preferred}
    others = [_item(k, c) for (k,c) in pool if k not in pref_keys]

    # Sort, diversify, cutoff
    preferred.sort(key=lambda x: x["probability"], reverse=True)
    others.sort(key=lambda x: x["probability"], reverse=True)

    per_uni = int(request.args.get("per_uni", 2))
    preferred = _top_per_university(preferred, per_uni=per_uni)
    others    = _top_per_university(others,    per_uni=per_uni)

    pref_n = int(request.args.get("pref_n", 10))
    alt_n  = int(request.args.get("alt_n", 10))

    return jsonify({
        "preferred": preferred[:pref_n],
        "alternatives": others[:alt_n],
        "total_considered": len(pool)
    })

# -------------------------------------------------------
# Root
# -------------------------------------------------------
@app.get("/")
def root():
    return {"name": "Unimatch AI", "message": "Backend is running. Use /api/health."}

@app.get("/api/kb/majors-full")
def kb_majors_full():
    """Return all majors with university associations."""
    def _load():
        p = pathlib.Path(__file__).resolve().parents[1] / "kb" / "majors.json"
        if p.exists():
            with open(p, "r", encoding="utf-8") as f:
                return json.load(f)
        return {}
    
    majors_kb = _load()
    unique_majors = sorted({v.get("major", "").strip() for v in majors_kb.values() if v.get("major")})
    
    return jsonify({
        "majors": unique_majors,
        "details": majors_kb,
        "count": len(unique_majors)
    })

if __name__ == "__main__":
    host = os.getenv("FLASK_HOST", "127.0.0.1")
    port = int(os.getenv("FLASK_PORT", "8000"))
    debug = os.getenv("FLASK_DEBUG", "True") == "True"
    app.run(host=host, port=port, debug=debug)