/**
 * Admin's form primitives, ported from apps/admin/src/components/form/.
 *
 * Copied verbatim rather than re-styled: a rep filling in a client is looking
 * at the same h-12 cream field with the same brand focus ring an admin sees,
 * because it is the same file. Only the subset the rep screens actually use is
 * here — no Combobox, since nothing on this surface needs one yet.
 *
 * They resolve admin's palette through the `.sales-app` scope in app.css:
 * `bg-surface-cream` is pure white in the customer app, which would make every
 * field here invisible against the card behind it.
 */
export { default as Select } from './Select';
export type { SelectFieldProps } from './Select';
export { default as TextField } from './TextField';
export type { TextFieldProps } from './TextField';
export { default as Textarea } from './Textarea';
export type { TextareaProps } from './Textarea';
export { default as Checkbox } from './Checkbox';
export type { CheckboxProps } from './Checkbox';
export { default as PasswordField } from './PasswordField';
export type { PasswordFieldProps } from './PasswordField';
