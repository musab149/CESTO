// Bilingual validation messages for the sales surface.
//
// The MESSAGES are admin's, copied from apps/admin/src/lib/validation/messages.ts
// so a field that fails validation says exactly what it says in the admin
// panel. Only the language source differs: apps/web does not bundle
// react-i18next, so this reads the Zustand languageStore — the same swap
// partner's copy makes, for the same reason.

import { useLanguageStore } from '@/stores/languageStore';

export interface ValidationMessages {
  required:       string;
  email:          string;
  passwordMin:    (n: number) => string;
  passwordWeak:   string;
  passwordMatch:  string;
  passwordSame:   string;
  nameMin:        (n: number) => string;
  nameMax:        (n: number) => string;
  phoneInvalid:   string;
  phoneInvalidIntl: string;
  postcodeFormat: string;
  urlInvalid:     string;
  tooLong:        (n: number) => string;
  tooShort:       (n: number) => string;
  numeric:        string;
  positive:       string;
  hexColor:       string;
  slug:           string;
}

const ES: ValidationMessages = {
  required:       'Este campo es obligatorio.',
  email:          'Introduce un correo electrónico válido.',
  passwordMin:    (n) => `La contraseña debe tener al menos ${n} caracteres.`,
  passwordWeak:   'La contraseña es demasiado débil. Combina mayúsculas, minúsculas y números.',
  passwordMatch:  'Las contraseñas no coinciden.',
  passwordSame:   'La nueva contraseña debe ser distinta de la actual.',
  nameMin:        (n) => `Debe tener al menos ${n} caracteres.`,
  nameMax:        (n) => `No puede superar los ${n} caracteres.`,
  phoneInvalid:   'Introduce un número de teléfono válido (9 dígitos).',
  phoneInvalidIntl:'Introduce un número válido (7 a 20 dígitos, opcionalmente con +).',
  postcodeFormat: 'El código postal debe tener 5 dígitos.',
  urlInvalid:     'Introduce una URL válida (https://…).',
  tooLong:        (n) => `Máximo ${n} caracteres.`,
  tooShort:       (n) => `Mínimo ${n} caracteres.`,
  numeric:        'Introduce solo números.',
  positive:       'El valor debe ser mayor que cero.',
  hexColor:       'Introduce un color hex válido (#RRGGBB).',
  slug:           'Sólo letras minúsculas, números y guiones.',
};

const EN: ValidationMessages = {
  required:       'This field is required.',
  email:          'Enter a valid email address.',
  passwordMin:    (n) => `Password must be at least ${n} characters.`,
  passwordWeak:   'Password is too weak. Mix upper- and lower-case letters with numbers.',
  passwordMatch:  'Passwords do not match.',
  passwordSame:   'New password must be different from the current one.',
  nameMin:        (n) => `Must be at least ${n} characters.`,
  nameMax:        (n) => `Cannot exceed ${n} characters.`,
  phoneInvalid:   'Enter a valid phone number (9 digits).',
  phoneInvalidIntl:'Enter a valid phone number (7–20 digits, optionally starting with +).',
  postcodeFormat: 'Postcode must be 5 digits.',
  urlInvalid:     'Enter a valid URL (https://…).',
  tooLong:        (n) => `Maximum ${n} characters.`,
  tooShort:       (n) => `Minimum ${n} characters.`,
  numeric:        'Enter numbers only.',
  positive:       'Value must be greater than zero.',
  hexColor:       'Enter a valid hex colour (#RRGGBB).',
  slug:           'Only lowercase letters, numbers and dashes.',
};

export function useValidationMessages(): ValidationMessages {
  const lang = useLanguageStore((st) => st.lang);
  return lang === 'es' ? ES : EN;
}
