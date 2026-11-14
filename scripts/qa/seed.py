import os
from datetime import date
from pathlib import Path
from django.conf import settings
from django.db import connection
from uuid import uuid5, NAMESPACE_OID
from django.utils import timezone
from postup.models import User, StudyGroup, AcademicProfile, Membership, Achievement, AchievementShare, AchievementEvent, Competition

database = Path(connection.settings_dict['NAME']).resolve()
if (settings.PRODUCTION or connection.vendor != "sqlite" or database.parent.name not in {"0.4.1-after", "0.4.1-before"}
        or database.parent.parent != (settings.BASE_DIR.parent / ".qa").resolve() or not database.name.startswith("qa-")):
    raise RuntimeError("The workspace fixture requires a dedicated SQLite QA database.")

def account(handle, name, role):
    user, _ = User.objects.get_or_create(username=handle, defaults={"full_name": name, "role": role})
    user.set_password(os.environ["POSTUP_QA_PASSWORD"])
    user.save()
    return user

t = account("qa_teacher", "Олена Приклад", "teacher")
p = account("qa_student", "Софія Приклад", "student")
u = account("qa_applicant", "Марко Приклад", "student")
other_teacher = account("qa_other_teacher", "Ірина Приклад", "teacher")
archived, _ = StudyGroup.objects.get_or_create(owner=t, name="Архівна група", year=2024, defaults={"archived": True})
foreign, _ = StudyGroup.objects.get_or_create(owner=other_teacher, name="Окрема академічна група", year=2026)
Membership.objects.get_or_create(student=u, group=archived, defaults={"status":"approved"})
Membership.objects.get_or_create(student=u, group=foreign, defaults={"status":"approved"})
AcademicProfile.objects.get_or_create(student=p, defaults={"school": "Умовний ліцей", "grade": "9 клас", "interests": ["Математика", "Дослідницькі проєкти"]})
a, _ = StudyGroup.objects.get_or_create(owner=t, name="Група дослідників", year=2026)
b, _ = StudyGroup.objects.get_or_create(owner=t, name="Олімпіадна підготовка", year=2026)
m, _ = Membership.objects.get_or_create(student=p, group=a, defaults={"status": "approved"})
n, _ = Membership.objects.get_or_create(student=p, group=b, defaults={"status": "approved"})
Membership.objects.get_or_create(student=u, group=a, defaults={"status": "pending"})
names = ["Міський турнір з математики", "Наукова конференція учнів", "Робототехнічний фестиваль"]
for i, name in enumerate(names):
    record, _ = Achievement.objects.get_or_create(id=uuid5(NAMESPACE_OID,name), defaults={
        "owner": p, "competition_proposal": name, "season_proposal": "2026/27", "stage_proposal": "Міський етап",
        "academic_year": 2026, "starts_on": date(2026,11,12-i), "status":"submitted", "version":1,
        "submission_count":1, "result_kind":"award", "award": ["Диплом I ступеня","Відзнака журі","Диплом II ступеня"][i],
    })
    share, _ = AchievementShare.objects.get_or_create(achievement=record, membership=m, defaults={"submitted_at":timezone.now(), "status":["submitted","clarify","verified"][i]})
    if i == 0:
        AchievementShare.objects.get_or_create(achievement=record, membership=n, defaults={"submitted_at":timezone.now(), "status":"verified"})
    if i in (1,2) and not share.decision_id:
        share.decision = AchievementEvent.objects.create(achievement_id=record.pk, actor=t, group=a, action=share.status, version=1,
            details={"comment":"Уточніть назву секції.", "basis":"known"} if i==1 else {"basis":"known","comment":"Результат відомий учителю."})
        share.save(update_fields=["decision"])
for i in range(90):
    name = "Тестовий учень " + str(i + 1).zfill(3)
    if i == 89:
        name = "Олександра-Єлизавета Довгопол-Степаненко"
    learner, _ = User.objects.get_or_create(username=f"qa_learner_{i}", defaults={"full_name":name,"role":"student"})
    member, _ = Membership.objects.get_or_create(student=learner, group=a if i % 2 == 0 else b, defaults={"status":"approved"})
    for j in range(4):
        key = f"qa-{i}-{j}"
        record, _ = Achievement.objects.get_or_create(id=uuid5(NAMESPACE_OID,key),defaults={
            "owner":learner,"competition":Competition.objects.order_by("id")[j],"season_proposal":"2025/26",
            "academic_year":2025,"starts_on":date(2026,4,j+1),"status":"submitted","version":1,"submission_count":1,
        })
        AchievementShare.objects.get_or_create(achievement=record,membership=member,defaults={"submitted_at":timezone.now(),"status":"verified"})
