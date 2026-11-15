// Bilingual validation messages — mirror of apps/web/src/lib/validation/messages.ts
// but bound to the mobile language store. Kept per-app so the validation layer
// can stay language-store agnostic.

import { useLanguageStore } from '../../stores/languageStore';

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
  termsRequired:  string;
  urlInvalid:     string;
  tooLong:        (n: number) => string;
  tooShort:       (n: number) => string;
  numeric:        string;
  positive:       string;
}

const ES: ValidationMessages = {
  required:       'Este campo es obligatorio.',
  email:          'Introduce un correo electrónico válido.',
  passwordMin:    (n) => `La contraseña debe tener al menos ${n} caracteres.`,
  passwordWeak:   'La contraseña es demasiado débil. Combina mayúsculas, minúsculas y números.',
  passwordMatch:  'Las contraseñas no coinciden.',
  passwordSame:   'La nueva contraseña debe ser distinta de la actual.',
  nameMin:        (n) => `El nombre debe tener al menos ${n} caracteres.`,
  nameMax:        (n) => `El nombre no puede superar los ${n} caracteres.`,
  phoneInvalid:   'Introduce un número de teléfono válido (9 dígitos).',
  phoneInvalidIntl:'Introduce un número válido (7 a 20 dígitos, opcionalmente con +).',
  postcodeFormat: 'El código postal debe tener 5 dígitos.',
  termsRequired:  'Debes aceptar los términos para continuar.',
  urlInvalid:     'Introduce una URL válida.',
  tooLong:        (n) => `Máximo ${n} caracteres.`,
  tooShort:       (n) => `Mínimo ${n} caracteres.`,
  numeric:        'Introduce solo números.',
  positive:       'El valor debe ser mayor que cero.',
};

const EN: ValidationMessages = {
  required:       'This field is required.',
  email:          'Enter a valid email address.',
  passwordMin:    (n) => `Password must be at least ${n} characters.`,
  passwordWeak:   'Password is too weak. Mix upper- and lower-case letters with numbers.',
  passwordMatch:  'Passwords do not match.',
  passwordSame:   'New password must be different from the current one.',
  nameMin:        (n) => `Name must be at least ${n} characters.`,
  nameMax:        (n) => `Name cannot exceed ${n} characters.`,
  phoneInvalid:   'Enter a valid phone number (9 digits).',
  phoneInvalidIntl:'Enter a valid phone number (7–20 digits, optionally starting with +).',
  postcodeFormat: 'Postcode must be 5 digits.',
  termsRequired:  'You must accept the terms to continue.',
  urlInvalid:     'Enter a valid URL.',
  tooLong:        (n) => `Maximum ${n} characters.`,
  tooShort:       (n) => `Minimum ${n} characters.`,
  numeric:        'Enter numbers only.',
  positive:       'Value must be greater than zero.',
};

export function useValidationMessages(): ValidationMessages {
  const lang = useLanguageStore((s) => s.lang);
  return lang === 'es' ? ES : EN;
}
