import csv
import random
from datetime import datetime, timedelta

random.seed(42)

NUM_STUDENTS = 100_000

first_names = [
    "Rahul", "Priya", "Aman", "Anuj", "Sneha",
    "Riya", "Karan", "Neha", "Arjun", "Meera",
    "Aditya", "Isha", "Rohan", "Kavya", "Vivek"
]

last_names = [
    "Sharma", "Singh", "Kumar", "Patel", "Gupta",
    "Verma", "Das", "Mehta", "Jain", "Yadav"
]

courses = [
    "Computer Science",
    "Information Technology",
    "Data Science",
    "Electronics",
    "Mechanical"
]

start_date = datetime(2020, 1, 1)

with open("../students_raw.csv", "w", newline="", encoding="utf-8") as file:

    writer = csv.writer(file)

    writer.writerow([
        "student_id",
        "name",
        "course",
        "age",
        "gender",
        "maths",
        "python",
        "dbms",
        "attendance",
        "enrollment_date"
    ])

    for i in range(1, NUM_STUDENTS + 1):

        student_id = f"S{i:06d}"

        name = (
            random.choice(first_names)
            + " "
            + random.choice(last_names)
        )

        course = random.choice(courses)

        age = random.randint(17, 25)

        gender = random.choice([
            "Male",
            "Female",
            "Other"
        ])

        maths = random.randint(30, 100)
        python = random.randint(30, 100)
        dbms = random.randint(30, 100)

        attendance = random.randint(50, 100)

        enrollment_date = (
            start_date +
            timedelta(days=random.randint(0, 2000))
        ).strftime("%Y-%m-%d")

        writer.writerow([
            student_id,
            name,
            course,
            age,
            gender,
            maths,
            python,
            dbms,
            attendance,
            enrollment_date
        ])

print("Generated 100,000 student records.")