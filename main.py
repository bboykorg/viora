"""
Viora — Flask-бэкенд: дерево решений и сценарный конструктор.

Провайдер ИИ (переменная VIORA_LLM_PROVIDER):
- ollama — локальная Ollama (по умолчанию)
- mistral — облачный Mistral API (OpenAI-совместимый /v1/chat/completions)

См. .env.example
- Параллельная обработка исходов в /run-ai-life через ThreadPoolExecutor.
- Streaming-эндпоинты (Server-Sent Events) для прогресса в реальном времени.
- Ретраи с экспоненциальной задержкой при ошибках Ollama.
- /healthz — health-check и сводка по модели.
- Чистые промпты без капслока (LLM лучше отвечают на спокойные инструкции).
- Логирование вместо print().
- Аккуратная обработка таймаутов, CORS, JSON-валидация.
"""
from __future__ import annotations

import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from typing import Any, Generator

import requests
from flask import Flask, Response, jsonify, render_template, request, stream_with_context

# ── Конфигурация ──────────────────────────────────────────────────────────────
def _normalize_llm_provider(raw: str) -> str:
    value = (raw or "ollama").strip().lower()
    if value in ("mistral", "mistralai", "api"):
        return "mistral"
    return "ollama"


@dataclass(frozen=True)
class Config:
    llm_provider: str
    ollama_url: str
    ollama_model: str
    mistral_api_key: str
    mistral_base_url: str
    mistral_model: str
    request_timeout: int
    max_workers: int
    max_retries: int
    port: int
    debug: bool
    cors_origin: str

    def active_model(self) -> str:
        return self.mistral_model if self.llm_provider == "mistral" else self.ollama_model


def load_config() -> Config:
    provider = _normalize_llm_provider(os.environ.get("VIORA_LLM_PROVIDER", "ollama"))
    return Config(
        llm_provider=provider,
        ollama_url=os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/"),
        ollama_model=os.environ.get("VIORA_MODEL", os.environ.get("OLLAMA_MODEL", "deepseek-r1:8b")),
        mistral_api_key=os.environ.get("MISTRAL_API_KEY", "").strip(),
        mistral_base_url=os.environ.get("MISTRAL_API_URL", "https://api.mistral.ai/v1").rstrip("/"),
        mistral_model=os.environ.get("MISTRAL_MODEL", "mistral-small-latest"),
        request_timeout=int(os.environ.get("VIORA_TIMEOUT", "90")),
        max_workers=int(os.environ.get("VIORA_MAX_WORKERS", "4")),
        max_retries=int(os.environ.get("VIORA_MAX_RETRIES", "2")),
        port=int(os.environ.get("PORT", "5001")),
        debug=os.environ.get("FLASK_DEBUG", "0") == "1",
        cors_origin=os.environ.get("CORS_ORIGIN", "*"),
    )


CFG = load_config()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
log = logging.getLogger("viora")

app = Flask(__name__)


# ── CORS (минимальный) ────────────────────────────────────────────────────────
@app.after_request
def add_cors(resp: Response) -> Response:
    resp.headers["Access-Control-Allow-Origin"] = CFG.cors_origin
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


# ── Промпты (без капслока, в спокойном тоне) ──────────────────────────────────
def build_prompt_pros_cons(title: str, outcome: str) -> str:
    return (
        "Ты — опытный аналитик решений и консультант. Проанализируй вариант "
        "решения и верни развёрнутый отчёт строго в указанном формате.\n\n"
        "Формат ответа:\n"
        f"ОПИСАНИЕ {outcome}\n"
        "(2–3 предложения по сути варианта, без воды)\n"
        "ПЛЮСЫ:\n"
        "(3–5 пунктов, каждый с новой строки, без маркеров)\n"
        "МИНУСЫ:\n"
        "(3–5 пунктов, каждый с новой строки, без маркеров)\n"
        "РИСКИ:\n"
        "(2–4 конкретных риска, что может пойти не так)\n"
        "РЕКОМЕНДАЦИИ:\n"
        "(2–4 конкретных шага, как повысить шансы на успех)\n"
        "ОЦЕНКА: N/10 — короткое обоснование одной фразой\n"
        "ВЕРДИКТ: 1–2 предложения с финальной рекомендацией\n\n"
        "Правила:\n"
        "1. Начни ответ строго со слова «ОПИСАНИЕ», без вступлений.\n"
        "2. Используй ровно указанные заголовки секций.\n"
        "3. Без маркеров (-, *, •), нумерации, точек с запятой.\n"
        "4. Конкретика вместо общих фраз. Каждый пункт — законченная мысль.\n"
        "5. Без вступлений, выводов и метакомментариев вне формата.\n\n"
        "Пример:\n"
        "ОПИСАНИЕ Переезд в другой город\n"
        "Смена места жительства ради новых карьерных возможностей и круга общения.\n"
        "ПЛЮСЫ:\n"
        "Новый круг общения и карьерные возможности\n"
        "Изменение жизненного контекста и привычек\n"
        "Освобождение от груза прошлого окружения\n"
        "МИНУСЫ:\n"
        "Финансовые расходы на переезд и аренду\n"
        "Стресс адаптации в первые месяцы\n"
        "Потеря привычной поддерживающей среды\n"
        "РИСКИ:\n"
        "Невозможность быстро найти работу в новом городе\n"
        "Одиночество и эмоциональное выгорание\n"
        "Несоответствие ожиданий реальности нового места\n"
        "РЕКОМЕНДАЦИИ:\n"
        "Накопить финансовую подушку минимум на 6 месяцев\n"
        "Заранее наладить контакты и согласовать работу\n"
        "Запланировать поездку-разведку на 1–2 недели\n"
        "ОЦЕНКА: 7/10 — перспективно при хорошей подготовке\n"
        "ВЕРДИКТ: Стоит делать, если есть финансовая подушка и предварительные контакты в новом городе.\n\n"
        f"Проблема: {title}\n"
        f"Вариант решения: {outcome}\n\n"
        f"Ответ (начни с «ОПИСАНИЕ {outcome}»):"
    )


def build_prompt_next_frame(title: str, current_frame: str) -> str:
    return (
        "Ты — кинорежиссёр. Предложи следующий кадр в сцене и подробно "
        "разбери его художественные средства.\n\n"
        "Формат ответа (строго эти заголовки, каждый с новой строки):\n"
        "СЛЕДУЮЩИЙ КАДР: <описание одной фразой>\n"
        "ВИЗУАЛЬНЫЕ ЭЛЕМЕНТЫ: элемент1; элемент2; элемент3\n"
        "ЭМОЦИОНАЛЬНОЕ ВОЗДЕЙСТВИЕ: эффект1; эффект2; эффект3\n"
        "КОМПОЗИЦИЯ: приём1; приём2; приём3\n"
        "ЗВУК И РИТМ: элемент1; элемент2\n"
        "ПЕРЕХОД: <одно предложение о том, как этот кадр соединяется с предыдущим>\n\n"
        "Правила: 3–5 пунктов в разделах со списком, через «;». Без маркеров, "
        "вступлений и выводов. Будь кинематографичен и конкретен.\n\n"
        f"Тема сцены: {title}\n"
        f"Текущий кадр: {current_frame}\n\n"
        "Ответ (начни со «СЛЕДУЮЩИЙ КАДР:»):"
    )


def build_prompt_analyze_frames(title: str, frames: list[str]) -> str:
    frames_text = "\n".join(f"{i + 1}. {f}" for i, f in enumerate(frames))
    return (
        "Ты — кинорежиссёр-аналитик. Сравни предложенные кадры, выбери лучший "
        "и дай развёрнутый разбор: композиция, атмосфера, драматургия, "
        "сильные стороны, что улучшить, куда развивать сцену дальше.\n\n"
        "Формат ответа (строго эти заголовки, каждый с новой строки):\n"
        "ЛУЧШИЙ КАДР: <номер кадра>\n"
        "ПОЧЕМУ ЭТОТ КАДР: <2–3 предложения обоснования>\n"
        "КОМПОЗИЦИЯ: приём1; приём2; приём3\n"
        "АТМОСФЕРА: тон1; тон2; тон3\n"
        "ДРАМАТУРГИЯ: момент1; момент2; момент3\n"
        "СИЛЬНЫЕ СТОРОНЫ: сторона1; сторона2; сторона3\n"
        "ВОЗМОЖНЫЕ УЛУЧШЕНИЯ: улучшение1; улучшение2; улучшение3\n"
        "СЛЕДУЮЩИЙ ШАГ: идея1; идея2; идея3\n"
        "ОЦЕНКА: N/10 — короткое обоснование\n"
        "ВЕРДИКТ: <1–2 предложения с финальной рекомендацией>\n\n"
        "Правила: 2–5 пунктов в разделах со списком, через «;». Будь объективен, "
        "говори кинематографическим языком, давай конструктивные рекомендации. "
        "Без маркеров (-, *, •), вступлений и метакомментариев вне формата.\n\n"
        f"Тема: {title}\n"
        f"Кадры:\n{frames_text}\n\n"
        "Ответ (начни с «ЛУЧШИЙ КАДР:»):"
    )


# ── Очистка ответа модели ─────────────────────────────────────────────────────
_PREAMBLE_PHRASES = (
    "как эксперт", "в качестве", "проанализировав",
    "рассмотрев вариант", "после анализа", "исходя из",
)
_CONCLUSION_PHRASES = (
    "в заключение", "таким образом", "в итоге",
    "подводя итоги", "в целом можно сказать",
)
# DeepSeek-R1 включает <think>…</think> блок размышлений — его удалим.
_THINK_BLOCK_RE = re.compile(r"<think>.*?</think>", re.DOTALL | re.IGNORECASE)


# Заголовки секций, после которых отключаем агрессивную фильтрацию преамбулы.
_SECTION_HEADERS_RE = re.compile(
    r"^\s*("
    r"ОПИСАНИЕ|ПЛЮСЫ?|МИНУСЫ?|РИСКИ?|РЕКОМЕНДАЦИИ|ОЦЕНКА|ВЕРДИКТ|"
    r"СЛЕДУЮЩИЙ\s+КАДР|ВИЗУАЛЬНЫЕ\s+ЭЛЕМЕНТЫ|ЭМОЦИОНАЛЬНОЕ\s+ВОЗДЕЙСТВИЕ|"
    r"КОМПОЗИЦИЯ|ЗВУК\s+И\s+РИТМ|ПЕРЕХОД|"
    r"ЛУЧШИЙ\s+КАДР|ПОЧЕМУ\s+ЭТОТ\s+КАДР|АТМОСФЕРА|ДРАМАТУРГИЯ|"
    r"СИЛЬНЫЕ\s+СТОРОНЫ|ВОЗМОЖНЫЕ\s+УЛУЧШЕНИЯ|СЛЕДУЮЩИЙ\s+ШАГ"
    r")\b",
    re.IGNORECASE,
)


def sanitize_ai_text(text: str, max_len: int = 4000) -> str:
    """Аккуратная очистка: убираем размышления и преамбулу, сохраняем структуру."""
    if not text:
        return ""
    text = _THINK_BLOCK_RE.sub("", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()

    cleaned_lines: list[str] = []
    seen_section = False

    for raw in text.split("\n"):
        line = raw.strip()
        if not line:
            cleaned_lines.append("")
            continue

        if _SECTION_HEADERS_RE.match(line):
            seen_section = True
            cleaned_lines.append(line)
            continue

        # Преамбулу выкидываем только ДО первой секции и только если
        # строка реально начинается с одной из преамбульных фраз.
        if not seen_section:
            low = line.lower()
            if any(low.startswith(p) for p in _PREAMBLE_PHRASES):
                continue

        cleaned_lines.append(line)

    cleaned = "\n".join(cleaned_lines).strip()

    # Убираем маркеры списков ТОЛЬКО в начале строки (-, *, •, 1., 2)).
    cleaned = re.sub(r"^[\-\*\•\d]+[\.\)\s]+", "", cleaned, flags=re.MULTILINE)

    if len(cleaned) > max_len:
        cleaned = cleaned[:max_len].rstrip() + "…"
    return cleaned


# ── Парсинг секций ответа ИИ (структурированные поля для фронта) ─────────────
def _split_section_items(raw: str, *, max_items: int = 6) -> list[str]:
    items: list[str] = []
    for line in raw.split("\n"):
        line = re.sub(r"^[\-\*\•\d\.\)\s]+", "", line.strip()).strip()
        if len(line) > 2:
            items.append(line)
    return items[:max_items]


def _parse_sections(
    text: str,
    headers: list[tuple[str, str, bool]],
) -> dict[str, Any]:
    """headers: (key, regex_pattern, single_line)."""
    normalized = (text or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    single_line_by_key = {key: single for key, _, single in headers}
    positions: list[tuple[str, int, int, str]] = []
    for key, pattern, _single_line in headers:
        m = re.search(pattern, normalized, re.IGNORECASE | re.MULTILINE)
        if m:
            positions.append((key, m.start(), m.end(), m.group(1) if m.lastindex else ""))
    positions.sort(key=lambda x: x[1])

    description = ""
    if positions:
        description = normalized[: positions[0][1]].strip()
    elif normalized:
        description = normalized
    description = re.sub(r"^ОПИСАНИЕ[:\s]*", "", description, flags=re.IGNORECASE).strip()

    sections: dict[str, Any] = {}
    for i, (key, _start, end, capture) in enumerate(positions):
        next_start = positions[i + 1][1] if i + 1 < len(positions) else len(normalized)
        body = normalized[end:next_start].strip()
        if single_line_by_key.get(key):
            sections[key] = (capture or body.split("\n")[0] or "").strip()
        else:
            raw = capture or body
            if ";" in raw and "\n" not in raw.strip():
                sections[key] = [p.strip() for p in raw.split(";") if p.strip()]
            else:
                sections[key] = _split_section_items(body if not capture else capture + "\n" + body)

    return {"description": description, **sections}


_LIFE_HEADERS = [
    ("pros", r"^\s*ПЛЮСЫ?\s*:?\s*$", False),
    ("cons", r"^\s*МИНУСЫ?\s*:?\s*$", False),
    ("risks", r"^\s*РИСКИ?\s*:?\s*$", False),
    ("recommendations", r"^\s*РЕКОМЕНДАЦИИ\s*:?\s*$", False),
    ("rating", r"^\s*ОЦЕНКА\s*:\s*(.*)$", True),
    ("verdict", r"^\s*ВЕРДИКТ\s*:\s*(.*)$", True),
]


def parse_life_sections(text: str) -> dict[str, Any]:
    parsed = _parse_sections(text, _LIFE_HEADERS)
    return {
        "description": parsed.get("description", ""),
        "pros": parsed.get("pros", []),
        "cons": parsed.get("cons", []),
        "risks": parsed.get("risks", []),
        "recommendations": parsed.get("recommendations", []),
        "rating": parsed.get("rating", ""),
        "verdict": parsed.get("verdict", ""),
    }


def parse_flow_next_frame_sections(text: str) -> dict[str, Any]:
    def m(pattern: str) -> str:
        x = re.search(pattern, text or "", re.IGNORECASE)
        return x.group(1).strip() if x else ""

    def items(raw: str) -> list[str]:
        if not raw:
            return []
        return [p.strip() for p in re.split(r"[;\n]", raw) if p.strip()]

    return {
        "next_frame": m(r"СЛЕДУЮЩИЙ\s+КАДР:\s*([^\n]+)"),
        "visual_elements": items(m(r"ВИЗУАЛЬНЫЕ\s+ЭЛЕМЕНТЫ:\s*([^\n]+)")),
        "emotional_impact": items(m(r"ЭМОЦИОНАЛЬНОЕ\s+ВОЗДЕЙСТВИЕ:\s*([^\n]+)")),
        "composition": items(m(r"КОМПОЗИЦИЯ:\s*([^\n]+)")),
        "sound_rhythm": items(m(r"ЗВУК\s+И\s+РИТМ:\s*([^\n]+)")),
        "transition": m(r"ПЕРЕХОД:\s*([^\n]+)"),
    }


def parse_flow_analyze_sections(text: str) -> dict[str, Any]:
    parsed = _parse_sections(
        text,
        [
            ("best_frame", r"^\s*ЛУЧШИЙ\s+КАДР:\s*(.*)$", True),
            ("explanation", r"^\s*ПОЧЕМУ\s+ЭТОТ\s+КАДР:\s*(.*)$", True),
            ("composition", r"^\s*КОМПОЗИЦИЯ:\s*(.*)$", False),
            ("atmosphere", r"^\s*АТМОСФЕРА:\s*(.*)$", False),
            ("dramaturgy", r"^\s*ДРАМАТУРГИЯ:\s*(.*)$", False),
            ("strengths", r"^\s*СИЛЬНЫЕ\s+СТОРОНЫ:\s*(.*)$", False),
            ("improvements", r"^\s*ВОЗМОЖНЫЕ\s+УЛУЧШЕНИЯ:\s*(.*)$", False),
            ("next_steps", r"^\s*СЛЕДУЮЩИЙ\s+ШАГ:\s*(.*)$", False),
            ("score", r"^\s*ОЦЕНКА:\s*(.*)$", True),
            ("verdict", r"^\s*ВЕРДИКТ:\s*(.*)$", True),
        ],
    )
    # Однострочные секции flow-анализа часто идут списком через «;» в одной строке.
    for key in ("composition", "atmosphere", "dramaturgy", "strengths", "improvements", "next_steps"):
        val = parsed.get(key)
        if isinstance(val, list) and len(val) == 1 and ";" in val[0]:
            parsed[key] = [p.strip() for p in val[0].split(";") if p.strip()]
    return {
        "best_frame": parsed.get("best_frame", ""),
        "explanation": parsed.get("explanation", ""),
        "composition": parsed.get("composition", []),
        "atmosphere": parsed.get("atmosphere", []),
        "dramaturgy": parsed.get("dramaturgy", []),
        "strengths": parsed.get("strengths", []),
        "improvements": parsed.get("improvements", []),
        "next_steps": parsed.get("next_steps", []),
        "score": parsed.get("score", ""),
        "verdict": parsed.get("verdict", ""),
    }


def enrich_life_result(outcome: str, result: str, *, ok: bool = True, index: int | None = None) -> dict[str, Any]:
    payload: dict[str, Any] = {"outcome": outcome, "result": result, "ok": ok, **parse_life_sections(result)}
    if index is not None:
        payload["index"] = index
    return payload


# ── LLM: Ollama и Mistral API ─────────────────────────────────────────────────
class LLMError(Exception):
    """Ошибка запроса к провайдеру ИИ."""


OllamaError = LLMError  # обратная совместимость


def _retry_generate(label: str, call) -> str:
    last_err: Exception | None = None
    for attempt in range(1, CFG.max_retries + 2):
        try:
            return call()
        except requests.exceptions.Timeout as e:
            last_err = e
            log.warning("%s timeout (attempt %d)", label, attempt)
        except LLMError as e:
            last_err = e
            log.warning("%s failed (attempt %d): %s", label, attempt, e)
        except Exception as e:
            last_err = e
            log.warning("%s error (attempt %d): %s", label, attempt, e)
        if attempt <= CFG.max_retries:
            time.sleep(0.5 * attempt)
    raise LLMError(f"Все попытки исчерпаны: {last_err}")


def _ollama_generate_once(prompt: str, *, temperature: float) -> str:
    r = requests.post(
        f"{CFG.ollama_url}/api/generate",
        json={
            "model": CFG.ollama_model,
            "prompt": prompt,
            "temperature": temperature,
            "stream": False,
        },
        timeout=CFG.request_timeout,
    )
    if r.status_code != 200:
        raise LLMError(f"Ollama HTTP {r.status_code}: {r.text[:200]}")
    return sanitize_ai_text(r.json().get("response", ""))


def _mistral_generate_once(prompt: str, *, temperature: float) -> str:
    if not CFG.mistral_api_key:
        raise LLMError("MISTRAL_API_KEY не задан (нужен для VIORA_LLM_PROVIDER=mistral)")
    r = requests.post(
        f"{CFG.mistral_base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {CFG.mistral_api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": CFG.mistral_model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
        },
        timeout=CFG.request_timeout,
    )
    if r.status_code != 200:
        raise LLMError(f"Mistral HTTP {r.status_code}: {r.text[:300]}")
    data = r.json()
    choices = data.get("choices") or []
    if not choices:
        raise LLMError("Mistral: пустой ответ (нет choices)")
    message = choices[0].get("message") or {}
    content = message.get("content", "")
    if isinstance(content, list):
        # Некоторые модели отдают content как массив блоков
        parts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                parts.append(block.get("text", ""))
            elif isinstance(block, str):
                parts.append(block)
        content = "\n".join(p for p in parts if p)
    return sanitize_ai_text(str(content))


def llm_generate(prompt: str, *, temperature: float = 0.7) -> str:
    """Единая точка генерации: провайдер из VIORA_LLM_PROVIDER."""
    if CFG.llm_provider == "mistral":
        return _retry_generate("mistral_generate", lambda: _mistral_generate_once(prompt, temperature=temperature))
    return _retry_generate("ollama_generate", lambda: _ollama_generate_once(prompt, temperature=temperature))


def ollama_generate(prompt: str, *, temperature: float = 0.7, stream: bool = False) -> str:
    """Алиас для совместимости; stream игнорируется (используйте llm_generate)."""
    if stream:
        log.debug("ollama_generate(stream=True): стриминг только для Ollama, batch через llm_generate")
    if CFG.llm_provider == "mistral":
        return llm_generate(prompt, temperature=temperature)
    return _retry_generate("ollama_generate", lambda: _ollama_generate_once(prompt, temperature=temperature))


def ollama_stream(prompt: str, *, temperature: float = 0.7) -> Generator[str, None, None]:
    """Стрим токенов из Ollama (только провайдер ollama)."""
    if CFG.llm_provider == "mistral":
        raise LLMError("Стриминг через ollama_stream недоступен при VIORA_LLM_PROVIDER=mistral")
    r = requests.post(
        f"{CFG.ollama_url}/api/generate",
        json={
            "model": CFG.ollama_model,
            "prompt": prompt,
            "temperature": temperature,
            "stream": True,
        },
        timeout=CFG.request_timeout,
        stream=True,
    )
    if r.status_code != 200:
        raise LLMError(f"HTTP {r.status_code}: {r.text[:200]}")

    for line in r.iter_lines():
        if not line:
            continue
        try:
            chunk = json.loads(line)
        except json.JSONDecodeError:
            continue
        piece = chunk.get("response", "")
        if piece:
            yield piece
        if chunk.get("done"):
            return


def check_llm_health() -> dict[str, Any]:
    """Проверка активного провайдера для /healthz."""
    if CFG.llm_provider == "mistral":
        if not CFG.mistral_api_key:
            return {
                "status": "degraded",
                "provider": "mistral",
                "reachable": False,
                "error": "MISTRAL_API_KEY не задан",
                "model": CFG.mistral_model,
                "api_url": CFG.mistral_base_url,
            }
        try:
            r = requests.get(
                f"{CFG.mistral_base_url}/models",
                headers={"Authorization": f"Bearer {CFG.mistral_api_key}"},
                timeout=10,
            )
            models: list[str] = []
            if r.status_code == 200:
                payload = r.json()
                raw_models = payload.get("data") or payload.get("models") or []
                for m in raw_models:
                    if isinstance(m, dict):
                        name = m.get("id") or m.get("name")
                        if name:
                            models.append(str(name))
            return {
                "status": "ok" if r.status_code == 200 else "degraded",
                "provider": "mistral",
                "reachable": r.status_code == 200,
                "model": CFG.mistral_model,
                "model_listed": CFG.mistral_model in models if models else None,
                "api_url": CFG.mistral_base_url,
                "available_models": models[:20],
            }
        except Exception as e:
            return {
                "status": "error",
                "provider": "mistral",
                "reachable": False,
                "error": str(e),
                "model": CFG.mistral_model,
                "api_url": CFG.mistral_base_url,
            }

    try:
        r = requests.get(f"{CFG.ollama_url}/api/tags", timeout=5)
        ollama_ok = r.status_code == 200
        models: list[str] = []
        if ollama_ok:
            models = [m["name"] for m in r.json().get("models", [])]
        return {
            "status": "ok" if ollama_ok else "degraded",
            "provider": "ollama",
            "reachable": ollama_ok,
            "ollama_url": CFG.ollama_url,
            "model": CFG.ollama_model,
            "model_loaded": CFG.ollama_model in models,
            "available_models": models,
        }
    except Exception as e:
        return {"status": "error", "provider": "ollama", "reachable": False, "error": str(e)}


# ── Валидация ─────────────────────────────────────────────────────────────────
def _json_required(body: Any) -> dict:
    if not isinstance(body, dict):
        raise ValueError("Ожидался JSON-объект")
    return body


def _str_field(d: dict, key: str, *, max_len: int = 2000) -> str:
    val = d.get(key, "")
    if not isinstance(val, str):
        raise ValueError(f"Поле «{key}» должно быть строкой")
    val = val.strip()
    if not val:
        raise ValueError(f"Поле «{key}» не может быть пустым")
    if len(val) > max_len:
        raise ValueError(f"Поле «{key}» слишком длинное (>{max_len})")
    return val


def _list_field(d: dict, key: str, *, min_len: int = 1, max_items: int = 30) -> list[str]:
    val = d.get(key)
    if not isinstance(val, list):
        raise ValueError(f"Поле «{key}» должно быть массивом")
    if len(val) < min_len:
        raise ValueError(f"В поле «{key}» нужно хотя бы {min_len} элемент(ов)")
    if len(val) > max_items:
        raise ValueError(f"В поле «{key}» слишком много элементов (>{max_items})")
    cleaned = []
    for i, item in enumerate(val):
        if not isinstance(item, str):
            raise ValueError(f"{key}[{i}] должен быть строкой")
        item = item.strip()
        if item:
            cleaned.append(item[:1000])
    return cleaned


# ── Страницы ──────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/life")
def life():
    return render_template("life.html")


@app.route("/flow")
def flow():
    return render_template("flow.html")


# ── Health / version ──────────────────────────────────────────────────────────
@app.route("/healthz")
def healthz():
    """Проверяет доступность активного LLM-провайдера (Ollama или Mistral)."""
    info = check_llm_health()
    ok = info.get("status") == "ok" and info.get("reachable", False)
    return jsonify(info), 200 if ok else 503


# ── API: life — пакетный анализ исходов (параллельно) ────────────────────────
@app.route("/run-ai-life", methods=["POST"])
def run_ai_life():
    try:
        data = _json_required(request.get_json(silent=True))
        title = _str_field(data, "title")
        outcomes = _list_field(data, "outcomes", min_len=1, max_items=15)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    def analyze(outcome: str) -> dict:
        try:
            result = llm_generate(build_prompt_pros_cons(title, outcome), temperature=0.7)
            return enrich_life_result(outcome, result, ok=True)
        except Exception as e:
            log.exception("life analyze failed for %s", outcome)
            return enrich_life_result(outcome, f"Ошибка ИИ: {e}", ok=False)

    results: list[dict] = [None] * len(outcomes)  # type: ignore
    with ThreadPoolExecutor(max_workers=min(CFG.max_workers, len(outcomes))) as ex:
        future_to_idx = {ex.submit(analyze, o): i for i, o in enumerate(outcomes)}
        for fut in as_completed(future_to_idx):
            results[future_to_idx[fut]] = fut.result()

    return jsonify({"results": results}), 200


# ── API: life — streaming-вариант (SSE, по одному исходу) ─────────────────────
@app.route("/run-ai-life/stream", methods=["POST"])
def run_ai_life_stream():
    """Server-Sent Events: события 'result' приходят по мере готовности каждого исхода."""
    try:
        data = _json_required(request.get_json(silent=True))
        title = _str_field(data, "title")
        outcomes = _list_field(data, "outcomes", min_len=1, max_items=15)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    def event_stream() -> Generator[str, None, None]:
        yield f"event: start\ndata: {json.dumps({'total': len(outcomes)})}\n\n"

        def analyze(idx: int, outcome: str) -> tuple[int, dict]:
            try:
                result = llm_generate(build_prompt_pros_cons(title, outcome), temperature=0.7)
                return idx, enrich_life_result(outcome, result, ok=True, index=idx)
            except Exception as e:
                return idx, enrich_life_result(outcome, f"Ошибка ИИ: {e}", ok=False, index=idx)

        with ThreadPoolExecutor(max_workers=min(CFG.max_workers, len(outcomes))) as ex:
            futs = [ex.submit(analyze, i, o) for i, o in enumerate(outcomes)]
            for fut in as_completed(futs):
                idx, payload = fut.result()
                if "index" not in payload:
                    payload["index"] = idx
                yield f"event: result\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

        yield "event: done\ndata: {}\n\n"

    return Response(stream_with_context(event_stream()), mimetype="text/event-stream",
                    headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})


# ── API: flow ─────────────────────────────────────────────────────────────────
@app.route("/run-ai-flow-next-frame", methods=["POST"])
def run_ai_flow_next_frame():
    try:
        data = _json_required(request.get_json(silent=True))
        title = _str_field(data, "title")
        current_frame = _str_field(data, "current_frame")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        result = llm_generate(
            build_prompt_next_frame(title, current_frame), temperature=0.8
        )
    except Exception as e:
        log.exception("flow next_frame failed")
        return jsonify({"error": f"Ошибка ИИ: {e}"}), 502

    return jsonify({
        "title": title,
        "current_frame": current_frame,
        "result": result,
        **parse_flow_next_frame_sections(result),
    }), 200


@app.route("/run-ai-flow-analyze-frames", methods=["POST"])
def run_ai_flow_analyze_frames():
    try:
        data = _json_required(request.get_json(silent=True))
        title = _str_field(data, "title")
        frames = _list_field(data, "frames", min_len=2, max_items=20)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400

    try:
        result = llm_generate(
            build_prompt_analyze_frames(title, frames), temperature=0.3
        )
    except Exception as e:
        log.exception("flow analyze failed")
        return jsonify({"error": f"Ошибка ИИ: {e}"}), 502

    return jsonify({
        "title": title,
        "frames": frames,
        "result": result,
        **parse_flow_analyze_sections(result),
    }), 200


# ── Error handlers ────────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(_):
    return jsonify({"error": "Не найдено"}), 404


@app.errorhandler(500)
def internal_error(_):
    return jsonify({"error": "Внутренняя ошибка сервера"}), 500


if __name__ == "__main__":
    if CFG.llm_provider == "mistral" and not CFG.mistral_api_key:
        log.warning("VIORA_LLM_PROVIDER=mistral, но MISTRAL_API_KEY не задан")
    log.info(
        "Запуск Viora на :%d (provider=%s, model=%s, workers=%d, debug=%s)",
        CFG.port,
        CFG.llm_provider,
        CFG.active_model(),
        CFG.max_workers,
        CFG.debug,
    )
    if CFG.llm_provider == "ollama":
        log.info("Ollama: %s", CFG.ollama_url)
    else:
        log.info("Mistral API: %s", CFG.mistral_base_url)
    app.run(debug=CFG.debug, port=CFG.port, host=os.environ.get("HOST", "0.0.0.0"))
