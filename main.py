from flask import Flask, render_template, request, jsonify
import os
from mistralai import Mistral
import re

api_key1 = os.environ.get("MISTRAL_API_KEY1")
api_key2 = os.environ.get("MISTRAL_API_KEY2")
if not api_key1 or not api_key2:
    raise RuntimeError("MISTRAL_API_KEY1 и MISTRAL_API_KEY2 должны быть заданы в окружении")

model1 = "mistral-large-latest"
model2 = "mistral-tiny"

client1 = Mistral(api_key=api_key1)
client2 = Mistral(api_key=api_key2)

app = Flask(__name__)

def sanitize_ai_text(text, max_len=4000):
    if not text:
        return ""
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    lines = text.split('\n')
    kept = []
    for ln in lines:
        s = ln.strip()
        if not s:
            continue
        if re.match(r'^[-#\*\u2022]\s*', s):
            continue
        s = re.sub(r'^[\-\#\*\u2022]+\s*', '', s)
        s = s.replace(' * ', ' ').replace('*', '')
        kept.append(s)
    cleaned = '\n'.join(kept).strip()
    cleaned = re.sub(r'^[\-\#\*\u2022]+\s*', '', cleaned)
    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip() + '…'
    return cleaned

def build_prompt(title, outcome, strict=True):
    instructions = (
        "Инструкции: Ответь ТОЛЬКО по следующему исходу. "
        "Не упоминай другие варианты, не приводь сравнения с другими исходами. "
        "Не используй символы '-', '#', '*', '•' или списки. "
        "Не добавляй заголовков. Дай короткий и полезный ответ, максимум ~40-60 слов. "
        "Если нельзя дать рекомендацию — напиши одну-две короткие фразы, почему."
    )
    prompt = (
        f"{instructions}\n\n"
        f"Проблема/кадр: {title}\n"
        f"Исход: {outcome}\n\n"
        "Дай ответ как единый абзац — без списков, без нумерации, без маркеров.\n"
    )
    return prompt

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/life")
def life():
    return render_template("life.html")

@app.route("/flow")
def flow():
    return render_template("flow.html")

@app.route("/run-ai", methods=["POST"])
def run_ai():
    data = request.get_json() or {}
    title = data.get("title", "")
    outcomes = data.get("outcomes", [])

    if not title or not isinstance(outcomes, list) or len(outcomes) == 0:
        return jsonify({"error": "Expected JSON with 'title' and non-empty list 'outcomes'"}), 400

    results = []

    for i, outcome in enumerate(outcomes, start=1):
        prompt = build_prompt(title, outcome)
        attempts = 0
        used_model = None
        ai_text = ""
        try:
            attempts += 1
            resp1 = client1.chat.complete(
                model=model1,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0
            )
            try:
                ai_text_raw = getattr(resp1.choices[0].message, "content", None) or str(resp1)
            except Exception:
                ai_text_raw = str(resp1)
            ai_text = sanitize_ai_text(ai_text_raw)
            if ai_text:
                used_model = model1
        except Exception as e:
            print(f"[run-ai] model1 failed for #{i}: {e}")

        if not ai_text:
            try:
                attempts += 1
                resp2 = client2.chat.complete(
                    model=model2,
                    messages=[{"role": "user", "content": prompt}],
                    temperature=0.0
                )
                try:
                    ai_text_raw = getattr(resp2.choices[0].message, "content", None) or str(resp2)
                except Exception:
                    ai_text_raw = str(resp2)
                ai_text = sanitize_ai_text(ai_text_raw)
                if ai_text:
                    used_model = model2
            except Exception as e:
                print(f"[run-ai] model2 failed for #{i}: {e}")

        if used_model:
            print(f"[run-ai] outcome #{i}: succeeded with {used_model}, attempts={attempts}")
        else:
            print(f"[run-ai] outcome #{i}: failed after attempts={attempts}")

        if ai_text:
            results.append({"index": i, "outcome": outcome, "result": ai_text})
        else:
            results.append({"index": i, "outcome": outcome, "result": "Ошибка при получении ответа от ИИ. Попробуйте позже."})

    return jsonify({"title": title, "results": results}), 200

if __name__ == "__main__":
    app.run(debug=True)
