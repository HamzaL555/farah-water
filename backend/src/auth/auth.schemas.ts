import { z } from 'zod';

/** Password policy: at least 8 chars with a letter and a digit. */
export const strongPassword = z
  .string()
  .min(8, 'Şifrə ən azı 8 simvol olmalıdır.')
  .max(128, 'Şifrə çox uzundur.')
  .regex(/[A-Za-zÇĞİÖŞÜƏçğıöşüə]/, 'Şifrədə ən azı bir hərf olmalıdır.')
  .regex(/[0-9]/, 'Şifrədə ən azı bir rəqəm olmalıdır.');

export const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'İstifadəçi adı, e-mail və ya telefon daxil edin.').max(120),
  password: z.string().min(1, 'Şifrəni daxil edin.').max(128),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(10, 'Refresh token tələb olunur.'),
});

export const logoutSchema = z.object({
  refreshToken: z.string().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Cari şifrəni daxil edin.'),
  newPassword: strongPassword,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
