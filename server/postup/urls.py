from django.conf import settings
from django.contrib import admin
from django.urls import path

from . import api, attachments, groups, portfolio, review

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", api.health),
    path("api/session/", api.session),
    path("api/login/", api.sign_in),
    path("api/logout/", api.sign_out),
    path("api/register/", api.register),
    path("api/profile/", portfolio.my_profile),
    path("api/students/<int:student_id>/profile/", portfolio.student_profile),
    path("api/catalogue/", portfolio.catalogue),
    path("api/achievements/", portfolio.achievements),
    path("api/achievements/queue/", review.queue),
    path("api/notifications/", review.notifications),
    path("api/notifications/<int:event_id>/read/", review.read_notification),
    path("api/achievements/<uuid:record_id>/", portfolio.achievement),
    path("api/achievements/<uuid:record_id>/submit/", portfolio.submit),
    path("api/achievements/<uuid:record_id>/changes/", portfolio.discard_changes),
    path("api/achievements/<uuid:record_id>/history/", review.history),
    path("api/achievements/<uuid:record_id>/review/<int:group_id>/", review.decide),
    path("api/achievements/<uuid:record_id>/withdraw/", portfolio.withdraw),
    path("api/achievements/<uuid:record_id>/evidence/", portfolio.evidence),
    path("api/achievements/<uuid:record_id>/attachments/", attachments.upload),
    path("api/achievements/<uuid:record_id>/attachments/<uuid:attachment_id>/", attachments.remove),
    path("api/achievements/<uuid:record_id>/attachments/<uuid:attachment_id>/download/", attachments.download),
    path("api/groups/", groups.groups),
    path("api/groups/<int:group_id>/", groups.group_detail),
    path("api/groups/<int:group_id>/invitation/", groups.invitation),
    path("api/groups/<int:group_id>/members/<int:membership_id>/", groups.membership),
    path("api/join/", groups.join),
    path("api/memberships/", groups.memberships),
    path("api/review/", api.release_review),
]

if settings.SERVE_WEB:
    urlpatterns.append(path("", api.student_site))
