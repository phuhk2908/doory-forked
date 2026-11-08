import { lazy } from "react";

export const LandingPage = lazy(() => import("@/pages/LandingPage"));
export const TemplatesPage = lazy(() => import("@/pages/TemplatesPage"));
export const FeaturesPage = lazy(() => import("@/pages/FeaturesPage"));
export const FaqPage = lazy(() => import("@/pages/FaqPage"));
export const ContactPage = lazy(() => import("@/pages/ContactPage"));
export const TemplateDetailPage = lazy(
  () => import("@/pages/TemplateDetailPage"),
);
export const LoginPage = lazy(() => import("@/pages/auth/LoginPage"));
export const SignupPage = lazy(() => import("@/pages/auth/SignupPage"));
export const ForgotPasswordPage = lazy(
  () => import("@/pages/auth/ForgotPasswordPage"),
);
export const ResetPasswordPage = lazy(
  () => import("@/pages/auth/ResetPasswordPage"),
);
export const VerifyEmailPage = lazy(
  () => import("@/pages/auth/VerifyEmailPage"),
);
export const CreatePage = lazy(() => import("@/pages/CreatePage"));
export const LocalEditorPage = lazy(() => import("@/pages/LocalEditorPage"));
export const DesignEditorPage = lazy(() => import("@/pages/DesignEditorPage"));
export const CreateDrawingPage = lazy(
  () => import("@/pages/CreateDrawingPage"),
);
export const LocalDrawingPage = lazy(() => import("@/pages/LocalDrawingPage"));
export const DrawingRoomPage = lazy(() => import("@/pages/DrawingRoomPage"));
export const DrawingPage = lazy(() => import("@/pages/DrawingPage"));
export const SharedDesignPage = lazy(() => import("@/pages/SharedDesignPage"));
export const NotFoundPage = lazy(() => import("@/pages/NotFoundPage"));
export const DashboardLayout = lazy(
  () => import("@/features/dashboard/DashboardLayout"),
);
export const DashboardHomePage = lazy(
  () => import("@/pages/dashboard/HomePage"),
);
export const DesignsPage = lazy(() => import("@/pages/dashboard/DesignsPage"));
export const DrawingsPage = lazy(
  () => import("@/pages/dashboard/DrawingsPage"),
);
export const DashboardTemplatesPage = lazy(
  () => import("@/pages/dashboard/TemplatesPage"),
);
export const BrandPage = lazy(() => import("@/pages/dashboard/BrandPage"));
export const UploadsPage = lazy(() => import("@/pages/dashboard/UploadsPage"));
export const TrashPage = lazy(() => import("@/pages/dashboard/TrashPage"));
export const SettingsPage = lazy(
  () => import("@/pages/dashboard/SettingsPage"),
);
