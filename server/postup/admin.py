from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import ReleaseApproval, User


@admin.register(User)
class PostupUserAdmin(UserAdmin):
    fieldsets = (
        (None, {"fields": ("username", "password")}),
        ("Профіль", {"fields": ("full_name", "role", "is_active", "is_staff", "is_superuser")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": (
        "username", "full_name", "role", "password1", "password2",
    )}),)
    list_display = ("username", "full_name", "role", "is_active", "is_superuser")
    list_filter = ("role", "is_active", "is_superuser")
    search_fields = ("username", "full_name")


@admin.register(ReleaseApproval)
class ReleaseApprovalAdmin(admin.ModelAdmin):
    list_display = ("version", "teacher", "approved_at")
    list_filter = ("version",)
    ordering = ("-approved_at",)

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
