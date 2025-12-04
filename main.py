from flask import Flask, render_template, request, jsonify
import os
from mistralai import Mistral
import re

api_key = os.environ.get("MISTRAL_API_KEY")
if not api_key:
    raise RuntimeError("MISTRAL_API_KEY должен быть задан в окружении")

model = "mistral-tiny"
client = Mistral(api_key=api_key)

app = Flask(__name__)

def build_prompt(title, outcome):
    prompt = (
        "ТЫ ЭКСПЕРТ ПО АНАЛИЗУ РЕШЕНИЙ. ТВОЯ ЗАДАЧА - ПРОАНАЛИЗИРОВАТЬ ВАРИАНТ РЕШЕНИЯ И ВЫДАТЬ ОТВЕТ СТРОГО В УКАЗАННОМ ФОРМАТЕ.\n\n"

        "ФОРМАТ ОТВЕТА (НЕОТКЛОНЯЕМО):\n"
        f"ОПИСАНИЕ {outcome}\n"
        "ПЛЮСЫ:\n"
        "пункт1\n"
        "пункт2\n" 
        "пункт3\n"
        "МИНУСЫ:\n"
        "пункт1\n"
        "пункт2\n"
        "пункт3\n\n"

        "КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n"
        "1. ОТВЕТ ДОЛЖЕН НАЧИНАТЬСЯ С 'ОПИСАНИЕ [название исхода]' БЕЗ ЛЮБЫХ ПРЕДИСЛОВИЙ\n"
        "2. ПОСЛЕ ОПИСАНИЯ СРАЗУ ПИШИ 'ПЛЮСЫ:' С ПЕРЕНОСОМ СТРОКИ\n"
        "3. КАЖДЫЙ ПЛЮС ПИШИ С НОВОЙ СТРОКИ БЕЗ МАРКЕРОВ\n"
        "4. ПОСЛЕ ПОСЛЕДНЕГО ПЛЮСА СРАЗУ ПИШИ 'МИНУСЫ:' С ПЕРЕНОСОМ СТРОКИ\n"
        "5. КАЖДЫЙ МИНУС ПИШИ С НОВОЙ СТРОКИ БЕЗ МАРКЕРОВ\n"
        "6. НЕ ИСПОЛЬЗУЙ: маркеры (-, *, •), нумерацию (1., 2.), точки с запятой\n"
        "7. НЕ ДОБАВЛЯЙ: вступления, выводы, комментарии, пояснения\n"
        "8. КАЖДЫЙ ПУНКТ ДОЛЖЕН БЫТЬ КОНКРЕТНЫМ И ЗАКОНЧЕННЫМ\n"
        "9. ОБЯЗАТЕЛЬНО ВКЛЮЧИ И ПЛЮСЫ И МИНУСЫ ДАЖЕ ЕСЛИ ИХ МАЛО\n"
        "10. ОТ 3 ДО 5 ПУНКТОВ В КАЖДОМ РАЗДЕЛЕ\n\n"

        "ПРИМЕР ПРАВИЛЬНОГО ОТВЕТА:\n"
        "ОПИСАНИЕ Переезд в другой город\n"
        "ПЛЮСЫ:\n"
        "Быстрое достижение результата\n"
        "Низкие финансовые затраты\n"
        "Простота реализации\n"
        "МИНУСЫ:\n"
        "Риск неудачи\n"
        "Ограниченный масштаб\n"
        "Зависимость от внешних факторов\n\n"

        "АНАЛИЗИРУЕМ:\n"
        f"ПРОБЛЕМА: {title}\n"
        f"ВАРИАНТ РЕШЕНИЯ: {outcome}\n\n"

        f"ТВОЙ ОТВЕТ (НАЧИНАЙ С 'ОПИСАНИЕ {outcome}'):"
    )
    return prompt

def sanitize_ai_text(text, max_len=4000):
    if not text:
        return ""

    text = text.replace('\r\n', '\n').replace('\r', '\n').strip()
    lines = text.split('\n')
    cleaned_lines = []

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if any(phrase in line.lower() for phrase in [
            'как эксперт', 'в качестве', 'проанализировав',
            'рассмотрев вариант', 'после анализа', 'исходя из'
        ]):
            continue

        if any(phrase in line.lower() for phrase in [
            'в заключение', 'таким образом', 'в итоге',
            'подводя итоги', 'в целом можно сказать'
        ]):
            continue

        cleaned_lines.append(line)

    cleaned = '\n'.join(cleaned_lines)
    cleaned = re.sub(r'^[\-\*\•\d\.]+\s*', '', cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r'[\*\-\•]', '', cleaned)

    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip() + '…'

    return cleaned


def parse_pros_cons_from_text(text):
    """Парсит текст в формате с плюсами/минусами на новых строках"""
    if not text:
        return {"description": "", "pros": [], "cons": []}

    lines = text.split('\n')
    description = ""
    pros = []
    cons = []
    current_section = None

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.startswith('ОПИСАНИЕ'):
            description = line.replace('ОПИСАНИЕ', '').strip()
            current_section = None
        elif line == 'ПЛЮСЫ:':
            current_section = 'pros'
        elif line == 'МИНУСЫ:':
            current_section = 'cons'
        elif current_section == 'pros' and line and not line.endswith(':'):
            pros.append(line)
        elif current_section == 'cons' and line and not line.endswith(':'):
            cons.append(line)

    # Ограничиваем количество пунктов
    pros = pros[:5]
    cons = cons[:5]

    return {
        "description": description,
        "pros": pros,
        "cons": cons
    }

def build_prompt_flow_next_frame(title, current_frame):
    prompt = (
        "ТЫ РЕЖИССЕР ГОЛЛИВУДА С 20-ЛЕТНИМ ОПЫТОМ. ТВОЯ ЗАДАЧА - ПРЕДЛОЖИТЬ СЛЕДУЮЩИЙ КАДР ДЛЯ ФИЛЬМА.\n\n"

        "ФОРМАТ ОТВЕТА (СТРОГО СОБЛЮДАЙ):\n"
        "СЛЕДУЮЩИЙ КАДР: [описание следующего кадра]\n"
        "ВИЗУАЛЬНЫЕ ЭЛЕМЕНТЫ: элемент1; элемент2; элемент3\n"
        "ЭМОЦИОНАЛЬНОЕ ВОЗДЕЙСТВИЕ: эффект1; эффект2; эффект3\n\n"

        "КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n"
        "1. ОТВЕТ ДОЛЖЕН НАЧИНАТЬСЯ С 'СЛЕДУЮЩИЙ КАДР:' БЕЗ ПРЕДИСЛОВИЙ\n"
        "2. ПОСЛЕ ОПИСАНИЯ КАДРА СРАЗУ ПИШИ 'ВИЗУАЛЬНЫЕ ЭЛЕМЕНТЫ:'\n"
        "3. ПОСЛЕ ВИЗУАЛЬНЫХ ЭЛЕМЕНТОВ СРАЗУ ПИШИ 'ЭМОЦИОНАЛЬНОЕ ВОЗДЕЙСТВИЕ:'\n"
        "4. РАЗДЕЛЯЙ ПУНКТЫ ТОЧКОЙ С ЗАПЯТОЙ (;)\n"
        "5. НЕ ИСПОЛЬЗУЙ маркеры, нумерацию, переносы строк внутри разделов\n"
        "6. НЕ ДОБАВЛЯЙ вступления, выводы, комментарии\n"
        "7. ОТ 3 ДО 5 ПУНКТОВ В КАЖДОМ РАЗДЕЛЕ\n"
        "8. БУДЬ КРЕАТИВНЫМ И КИНЕМАТОГРАФИЧНЫМ\n\n"

        "РАБОТАЕМ НАД ФИЛЬМОМ:\n"
        f"ОСНОВНАЯ ТЕМА: {title}\n"
        f"ТЕКУЩИЙ КАДР: {current_frame}\n\n"

        "ТВОЙ ОТВЕТ (НАЧИНАЙ С 'СЛЕДУЮЩИЙ КАДР:'):"
    )
    return prompt


def build_prompt_flow_analyze_frames(title, frames):
    frames_text = "\n".join([f"{i + 1}. {frame}" for i, frame in enumerate(frames)])

    prompt = (
        "ТЫ РЕЖИССЕР ГОЛЛИВУДА С 20-ЛЕТНИМ ОПЫТОМ. ТВОЯ ЗАДАЧА - ВЫБРАТЬ ЛУЧШИЙ КАДР И ОБЪЯСНИТЬ СВОЙ ВЫБОР.\n\n"

        "ФОРМАТ ОТВЕТА (СТРОГО СОБЛЮДАЙ):\n"
        "ЛУЧШИЙ КАДР: [номер кадра]\n"
        "ПОЧЕМУ ЭТОТ КАДР: [развернутое объяснение выбора]\n"
        "СИЛЬНЫЕ СТОРОНЫ: сторона1; сторона2; сторона3\n"
        "ВОЗМОЖНЫЕ УЛУЧШЕНИЯ: улучшение1; улучшение2; улучшение3\n\n"

        "КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n"
        "1. ОТВЕТ ДОЛЖЕН НАЧИНАТЬСЯ С 'ЛУЧШИЙ КАДР:' БЕЗ ПРЕДИСЛОВИЙ\n"
        "2. УКАЖИ НОМЕР КАДРА (1, 2, 3 и т.д.)\n"
        "3. ОБЪЯСНИ СВОЙ ВЫБОР КИНЕМАТОГРАФИЧЕСКИМ ЯЗЫКОМ\n"
        "4. БУДЬ ОБЪЕКТИВНЫМ И ПРОФЕССИОНАЛЬНЫМ\n"
        "5. ДАЙ КОНСТРУКТИВНЫЕ РЕКОМЕНДАЦИИ\n\n"

        "АНАЛИЗИРУЕМ КАДРЫ:\n"
        f"ОСНОВНАЯ ТЕМА: {title}\n"
        f"ПРЕДЛОЖЕННЫЕ КАДРЫ:\n{frames_text}\n\n"

        "ТВОЙ ОТВЕТ (НАЧИНАЙ С 'ЛУЧШИЙ КАДР:'):"
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

@app.route("/run-ai-life", methods=["POST"])
def run_ai_life():
    data = request.get_json() or {}
    title = data.get("title", "")
    outcomes = data.get("outcomes", [])

    if not title or not outcomes:
        return jsonify({"error": "Expected JSON with 'title' and 'outcomes'"}), 400

    results = []

    for outcome in outcomes:
        prompt = build_prompt(title, outcome)
        ai_text = ""

        try:
            resp = client.chat.complete(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.7
            )
            ai_text_raw = getattr(resp.choices[0].message, "content", None) or str(resp)
            ai_text = sanitize_ai_text(ai_text_raw)
            print(f"[run-ai-life] succeeded for outcome: {outcome}")
        except Exception as e:
            print(f"[run-ai-life] failed for outcome {outcome}: {e}")
            ai_text = "Ошибка при получении ответа от ИИ. Попробуйте позже."

        results.append({
            "outcome": outcome,
            "result": ai_text
        })

    return jsonify({"results": results}), 200

@app.route("/run-ai-flow-next-frame", methods=["POST"])
def run_ai_flow_next_frame():
    data = request.get_json() or {}
    title = data.get("title", "")
    current_frame = data.get("current_frame", "")

    if not title or not current_frame:
        return jsonify({"error": "Expected JSON with 'title' and 'current_frame'"}), 400

    prompt = build_prompt_flow_next_frame(title, current_frame)
    ai_text = ""

    try:
        resp = client.chat.complete(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.8
        )
        ai_text_raw = getattr(resp.choices[0].message, "content", None) or str(resp)
        ai_text = sanitize_ai_text(ai_text_raw)
        print(f"[run-ai-flow-next-frame] succeeded with {model}")
    except Exception as e:
        print(f"[run-ai-flow-next-frame] failed: {e}")
        ai_text = "Ошибка при получении ответа от ИИ. Попробуйте позже."

    return jsonify({
        "title": title,
        "current_frame": current_frame,
        "result": ai_text
    }), 200


@app.route("/run-ai-flow-analyze-frames", methods=["POST"])
def run_ai_flow_analyze_frames():
    data = request.get_json() or {}
    title = data.get("title", "")
    frames = data.get("frames", [])

    if not title or not isinstance(frames, list) or len(frames) < 2:
        return jsonify({"error": "Expected JSON with 'title' and at least 2 frames"}), 400

    prompt = build_prompt_flow_analyze_frames(title, frames)
    ai_text = ""

    try:
        resp = client.chat.complete(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.3
        )
        ai_text_raw = getattr(resp.choices[0].message, "content", None) or str(resp)
        ai_text = sanitize_ai_text(ai_text_raw)
        print(f"[run-ai-flow-analyze-frames] succeeded with {model}")
    except Exception as e:
        print(f"[run-ai-flow-analyze-frames] failed: {e}")
        ai_text = "Ошибка при получении ответа от ИИ. Попробуйте позже."

    return jsonify({
        "title": title,
        "frames": frames,
        "result": ai_text
    }), 200


if __name__ == "__main__":
    app.run(debug=True, port=5001)
