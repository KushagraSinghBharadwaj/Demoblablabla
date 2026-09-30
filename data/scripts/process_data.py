
import csv
from pathlib import Path

# Project folders
BASE_DIR = Path(__file__).resolve().parents[2]

INPUT_FILE = BASE_DIR / "data" / "students_raw.csv"
OUTPUT_FILE = (
    BASE_DIR / "data" / "processed" / "students_processed.csv"
)

MARK_COLUMNS = ["maths", "python", "dbms"]

def process_data():
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(INPUT_FILE, "r", newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)

        required = [
            "student_id", "name", "course", "age",
            "gender", "maths", "python", "dbms",
            "attendance", "enrollment_date"
        ]

        if reader.fieldnames != required:
            raise ValueError("Unexpected dataset columns.")

        output_columns = required + ["average_marks"]

        total_rows = 0
        invalid_rows = 0

        with open(
            OUTPUT_FILE, "w", newline="", encoding="utf-8"
        ) as output:
            writer = csv.DictWriter(
                output, fieldnames=output_columns
            )
            writer.writeheader()

            for row in reader:
                # Remove unwanted spaces from text fields
                for key in row:
                    row[key] = (row[key] or "").strip()

                try:
                    marks = [int(row[key]) for key in MARK_COLUMNS]
                    age = int(row["age"])
                    attendance = float(row["attendance"])

                    if not all(30 <= mark <= 100 for mark in marks):
                        raise ValueError("Invalid marks")

                    if not 50 <= attendance <= 100:
                        raise ValueError("Invalid attendance")

                    if age <= 0 or not row["student_id"] or not row["name"]:
                        raise ValueError("Invalid student details")

                    row["average_marks"] = round(
                        sum(marks) / len(marks), 2
                    )

                except (ValueError, TypeError):
                    invalid_rows += 1
                    continue

                writer.writerow(row)
                total_rows += 1

    print("===== DATA PROCESSING COMPLETE =====")
    print("Valid records:", total_rows)
    print("Skipped records:", invalid_rows)
    print("Output file:", OUTPUT_FILE)

if __name__ == "__main__":
    process_data()
