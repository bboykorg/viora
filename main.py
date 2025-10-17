from flask import Flask, render_template

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

if __name__ == "__main__":
    app.run(debug=True)
