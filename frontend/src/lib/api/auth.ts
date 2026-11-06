import type { ApiUser, GoogleLoginResult, RegisterInput } from "@/types/api";
import { API_BASE, buildQuery, http } from "./client";

export const authApi = {
  csrf: () => http.get<void>("/auth/csrf/"),
  /** Never rejects with 401: `user` is null for anonymous visitors. */
  me: (signal?: AbortSignal) =>
    http.get<{ user: ApiUser | null }>("/auth/me/", {
      signal,
      silentUnauthorized: true,
    }),
  register: (input: RegisterInput) =>
    http.post<{ user: ApiUser }>("/auth/register/", {
      json: input,
      silentUnauthorized: true,
    }),
  login: (input: { email: string; password: string }) =>
    http.post<{ user: ApiUser }>("/auth/login/", {
      json: input,
      silentUnauthorized: true,
    }),
  logout: () => http.post<void>("/auth/logout/", { silentUnauthorized: true }),
  google: (credential: string) =>
    http.post<GoogleLoginResult>("/auth/google/", {
      json: { credential },
      silentUnauthorized: true,
    }),
  /** Where the browser goes to sign in with the server's OpenID Connect provider; it comes back to `next`. */
  oidcStartUrl: (next: string) =>
    `${API_BASE}/auth/oidc/start/${buildQuery({ next })}`,
  /** Confirms it is the account's owner and returns the provider URL that connects their account there. */
  oidcConnect: (input: { password?: string; confirm_email?: string }) =>
    http.post<{ redirect_url: string }>("/auth/oidc/connection/", {
      json: input,
    }),
  oidcDisconnect: () =>
    http.delete<{ user: ApiUser }>("/auth/oidc/connection/"),
  updateProfile: (input: { display_name: string }) =>
    http.patch<{ user: ApiUser }>("/auth/me/", { json: input }),
  uploadAvatar: (file: Blob, filename = "avatar") => {
    const form = new FormData();
    form.append("avatar", file, filename);
    return http.patch<{ user: ApiUser }>("/auth/me/", { form });
  },
  removeAvatar: () =>
    http.patch<{ user: ApiUser }>("/auth/me/", {
      json: { remove_avatar: true },
    }),
  deleteAccount: (input: { password?: string; confirm_email?: string }) =>
    http.delete<void>("/auth/me/", { json: input }),
  changePassword: (input: { old_password?: string; new_password: string }) =>
    http.post<void>("/auth/password/change/", { json: input }),
  requestPasswordReset: (email: string) =>
    http.post<void>("/auth/password/reset/", {
      json: { email },
      silentUnauthorized: true,
    }),
  confirmPasswordReset: (input: {
    uid: string;
    token: string;
    new_password: string;
  }) =>
    http.post<void>("/auth/password/reset/confirm/", {
      json: input,
      silentUnauthorized: true,
    }),
  verifyEmail: (input: { uid: string; token: string }) =>
    http.post<void>("/auth/email/verify/", {
      json: input,
      silentUnauthorized: true,
    }),
  resendVerification: () => http.post<void>("/auth/email/resend/"),
};
