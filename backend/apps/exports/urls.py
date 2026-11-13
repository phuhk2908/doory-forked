from django.urls import path

from .views import ExportJobView, ImageDownloadView, ImageExportView, ImageOptimizeView, PdfExportView

urlpatterns = [
    path("exports/pdf/", PdfExportView.as_view(), name="export-pdf"),
    path("exports/optimize/", ImageOptimizeView.as_view(), name="export-optimize"),
    path("exports/jobs/<uuid:pk>/", ExportJobView.as_view(), name="export-job"),
    path("designs/<uuid:pk>/export/image/", ImageExportView.as_view(), name="export-image"),
    path("exports/image/<str:token>/", ImageDownloadView.as_view(), name="export-image-download"),
]
