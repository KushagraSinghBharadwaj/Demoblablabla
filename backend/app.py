from flask import Flask, jsonify, request

app = Flask(__name__)


@app.route("/")
def home():
    return jsonify({
        "message": "Student Performance Backend is running!"
    })


@app.route("/analyze", methods=["POST"])
def analyze():
    data = request.get_json()

    name = data["name"]
    maths = data["maths"]
    python = data["python"]
    dbms = data["dbms"]

    score = (maths + python + dbms) / 3

    if score >= 80:
        category = "Excellent"
    elif score >= 60:
        category = "Good"
    elif score >= 40:
        category = "Average"
    else:
        category = "Needs Improvement"

    return jsonify({
        "name": name,
        "score": round(score, 2),
        "category": category
    })


if __name__ == "__main__":
    app.run(debug=True)