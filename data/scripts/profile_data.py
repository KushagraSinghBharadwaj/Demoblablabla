import csv
from collections import Counter

file_path = "../students_raw.csv"

rows = 0
missing = Counter()
student_ids = []
courses = Counter()
genders = Counter()

maths_values = []
python_values = []
dbms_values = []
attendance_values = []

with open(file_path, "r", encoding="utf-8") as file:

    reader = csv.DictReader(file)

    columns = reader.fieldnames

    for row in reader:

        rows += 1

        # Missing values
        for column in columns:
            if not row[column].strip():
                missing[column] += 1

        # IDs
        student_ids.append(row["student_id"])

        # Categories
        courses[row["course"]] += 1
        genders[row["gender"]] += 1

        # Numeric values
        maths_values.append(int(row["maths"]))
        python_values.append(int(row["python"]))
        dbms_values.append(int(row["dbms"]))
        attendance_values.append(int(row["attendance"]))


duplicate_ids = len(student_ids) - len(set(student_ids))

print("\n===== DATASET PROFILE =====")

print("Rows:", rows)
print("Columns:", len(columns))

print("\nColumns:")
for column in columns:
    print("-", column)

print("\nMissing values:")
for column in columns:
    print(column, ":", missing[column])

print("\nDuplicate student IDs:", duplicate_ids)

print("\nCourses:")
for course, count in courses.items():
    print(course, ":", count)

print("\nGender:")
for gender, count in genders.items():
    print(gender, ":", count)

print("\nMarks:")
print("Maths   :", min(maths_values), "-", max(maths_values))
print("Python  :", min(python_values), "-", max(python_values))
print("DBMS    :", min(dbms_values), "-", max(dbms_values))

print("\nAttendance:")
print(min(attendance_values), "-", max(attendance_values))

print("\n===== END PROFILE =====")