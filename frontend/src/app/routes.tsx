import { Suspense } from "react";
import { Navigate, type RouteObject } from "react-router-dom";
import { RequireAuth } from "@/features/auth/RequireAuth";
import { PageLoader } from "./PageLoader";
import { RouteErrorPage } from "./RouteErrorPage";
import { AuthLayout } from "./layouts/AuthLayout";
import {
  BrandPage,
  ContactPage,
  CreateDrawingPage,
  CreatePage,
  DashboardHomePage,
  DashboardLayout,
  DashboardTemplatesPage,
  DesignEditorPage,
  DesignsPage,
  DrawingPage,
  DrawingRoomPage,
  DrawingsPage,
  FaqPage,
  FeaturesPage,
  ForgotPasswordPage,
  LandingPage,
  LocalDrawingPage,
  LocalEditorPage,
  LoginPage,
  NotFoundPage,
  ResetPasswordPage,
  SettingsPage,
  SharedDesignPage,
  SignupPage,
  TemplateDetailPage,
  TemplatesPage,
  TrashPage,
  UploadsPage,
  VerifyEmailPage,
} from "./lazyPages";
import { MarketingLayout } from "./layouts/MarketingLayout";
import { RootLayout } from "./layouts/RootLayout";

const page = (element: React.ReactNode) => (
  <Suspense fallback={<PageLoader />}>{element}</Suspense>
);

export const routes: RouteObject[] = [
  {
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        element: <MarketingLayout />,
        children: [
          { index: true, element: <LandingPage /> },
          { path: "templates", element: <TemplatesPage /> },
          { path: "templates/:slug", element: <TemplateDetailPage /> },
          { path: "features", element: <FeaturesPage /> },
          { path: "faq", element: <FaqPage /> },
          { path: "contact", element: <ContactPage /> },
          { path: "*", element: <NotFoundPage /> },
        ],
      },
      {
        element: <AuthLayout />,
        children: [
          { path: "login", element: <LoginPage /> },
          { path: "signup", element: <SignupPage /> },
          { path: "forgot-password", element: <ForgotPasswordPage /> },
          { path: "reset-password", element: <ResetPasswordPage /> },
          { path: "verify-email", element: <VerifyEmailPage /> },
        ],
      },
      { path: "create", element: page(<CreatePage />) },
      { path: "local/:localId", element: page(<LocalEditorPage />) },
      { path: "drawings/new", element: page(<CreateDrawingPage />) },
      { path: "drawings/local/:localId", element: page(<LocalDrawingPage />) },
      { path: "drawings/room", element: page(<DrawingRoomPage />) },
      { path: "s/:token", element: page(<SharedDesignPage />) },
      {
        element: <RequireAuth keepOpenWhenSessionEnds />,
        children: [
          { path: "design/:id", element: page(<DesignEditorPage />) },
          { path: "drawings/:id", element: page(<DrawingPage />) },
        ],
      },
      {
        element: <RequireAuth />,
        children: [
          {
            element: page(<DashboardLayout />),
            children: [
              { path: "dashboard", element: <DashboardHomePage /> },
              { path: "dashboard/designs", element: <DesignsPage /> },
              {
                path: "dashboard/designs/folder/:folderId",
                element: <DesignsPage />,
              },
              { path: "dashboard/drawings", element: <DrawingsPage /> },
              { path: "dashboard/starred", element: <DesignsPage starred /> },
              {
                path: "dashboard/templates",
                element: <DashboardTemplatesPage />,
              },
              { path: "dashboard/brand", element: <BrandPage /> },
              { path: "dashboard/uploads", element: <UploadsPage /> },
              { path: "dashboard/trash", element: <TrashPage /> },
              { path: "settings", element: <SettingsPage /> },
            ],
          },
        ],
      },
      { path: "dashboard/*", element: <Navigate to="/dashboard" replace /> },
    ],
  },
];
