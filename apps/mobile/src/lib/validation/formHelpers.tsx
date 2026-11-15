// Bridges react-hook-form's controlled value model with RN's TextInput which
// emits onChangeText (string) instead of an onChange event. Wraps the
// boilerplate Controller render so a screen can write:
//
//   <ControlledTextField control={control} name="email" ... />
//
// …instead of repeating the same Controller/render block per field.
//
// The `Control<T, unknown, T>` generics below match the shape returned by
// useForm() when typed via zodResolver — RHF widens the third generic to
// the resolver's transformed-values type, and without explicit generics here
// TS complains about an unbound TFieldValues parameter at the call site.

import type { Control, FieldValues, Path } from 'react-hook-form';
import { Controller } from 'react-hook-form';
import TextInputField, { type TextInputFieldProps } from '../../components/form/TextInputField';
import PasswordField, { type PasswordFieldProps } from '../../components/form/PasswordField';
import Checkbox, { type CheckboxProps } from '../../components/form/Checkbox';

type ControlledTextFieldProps<T extends FieldValues> = Omit<
  TextInputFieldProps,
  'value' | 'onChange' | 'onChangeText' | 'onBlur' | 'error'
> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: Path<T>;
  /** When true the input ref is set so the field can be focus()'d on submit. */
  registerRef?: (el: import('react-native').TextInput | null) => void;
};

export function ControlledTextField<T extends FieldValues>({
  control, name, registerRef, ...rest
}: ControlledTextFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <TextInputField
          {...rest}
          ref={registerRef}
          value={(field.value ?? '') as string}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

type ControlledPasswordFieldProps<T extends FieldValues> = Omit<
  PasswordFieldProps,
  'value' | 'onChange' | 'onChangeText' | 'onBlur' | 'error'
> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: Path<T>;
};

export function ControlledPasswordField<T extends FieldValues>({
  control, name, ...rest
}: ControlledPasswordFieldProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <PasswordField
          {...rest}
          value={(field.value ?? '') as string}
          onChangeText={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}

type ControlledCheckboxProps<T extends FieldValues> = Omit<
  CheckboxProps,
  'value' | 'onChange' | 'onBlur' | 'error'
> & {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  control: Control<T, any, any>;
  name: Path<T>;
};

export function ControlledCheckbox<T extends FieldValues>({
  control, name, ...rest
}: ControlledCheckboxProps<T>) {
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Checkbox
          {...rest}
          value={!!field.value}
          onChange={field.onChange}
          onBlur={field.onBlur}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
