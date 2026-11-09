from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("drawings", "0006_collaborators_and_audit"),
    ]

    operations = [
        migrations.AddField(
            model_name="drawingroom",
            name="link_mode",
            field=models.CharField(
                choices=[("view", "Can view"), ("edit", "Can edit")],
                default="edit",
                max_length=4,
            ),
        ),
    ]
