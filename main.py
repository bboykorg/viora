from flask import Flask, render_template, request, jsonify
import os
from mistralai import Mistral

api_key = os.environ["MISTRAL_API_KEY"]
model = "mistral-large-latest"

client = Mistral(api_key=api_key)

app = Flask(__name__)

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/life")
def life():
    return render_template("life.html")

@app.route("/flow")
def flow():
    return render_template("flow.html")

@app.route("/runAi", methods=["POST"])
def run_ai():
    data = request.json
    title = data.get("title", "")
    outcomes = data.get("outcomes", [])

    content = f"Проблема/кадр: {title}\nВарианты/исходы:\n"
    for i, o in enumerate(outcomes, 1):
        content += f"{i}. {o}\n"
    content += "\nПредложи лучший вариант и поясни, почему."

    chat_response = client.chat.complete(
        model=model,
        messages=[
            {
                "role": "user",
                "content": content,
            },
        ]
    return jsonify({"result": chat_response.choices[0].message.content})

if __name__ == "__main__":

    app.run(debug=True)
