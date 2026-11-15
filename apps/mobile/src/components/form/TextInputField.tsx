import { forwardRef, useState, type ReactNode } from 'react';
import { View, Text, TextInput, type TextInputProps, StyleSheet } from 'react-native';
import { AlertCircle } from 'lucide-react-native';
import { colors } from '../../constants/colors';

export interface TextInputFieldProps extends TextInputProps {
  label?: string;
  leadingIcon?: ReactNode;
  /** Rendered to the right of the input (e.g. eye toggle on PasswordField). */
  trailing?: ReactNode;
  error?: string;
  hint?: string;
  /** Optional ref forwarded to the underlying TextInput. */
  inputContainerStyle?: object;
}

/**
 * Mobile counterpart to the web TextField primitive — matches the existing
 * RN design: 52px tall, surface.cream background, rounded 12, brand border
 * on focus. Errors paint the border red and surface a message under the row.
 */
const TextInputField = forwardRef<TextInput, TextInputFieldProps>(
  function TextInputField(
    { label, leadingIcon, trailing, error, hint, inputContainerStyle, onFocus, onBlur, ...inputProps },
    ref,
  ) {
    const [focused, setFocused] = useState(false);
    const wrapper = [
      styles.inputWrapper,
      focused && styles.inputWrapperFocused,
      !!error && styles.inputWrapperError,
      inputContainerStyle,
    ];

    return (
      <View style={styles.group}>
        {label && <Text style={styles.label}>{label}</Text>}
        <View style={wrapper}>
          {leadingIcon ? <View style={styles.leading}>{leadingIcon}</View> : null}
          <TextInput
            ref={ref}
            style={styles.input}
            placeholderTextColor={colors.muted}
            onFocus={(e) => { setFocused(true); onFocus?.(e); }}
            onBlur={(e) => { setFocused(false); onBlur?.(e); }}
            {...inputProps}
          />
          {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
        </View>
        {error ? (
          <View style={styles.errorRow}>
            <AlertCircle size={12} color={colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : hint ? (
          <Text style={styles.hintText}>{hint}</Text>
        ) : null}
      </View>
    );
  },
);

export default TextInputField;

const styles = StyleSheet.create({
  group: {
    marginBottom: 14,
  },
  label: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.ink,
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    borderRadius: 12,
    backgroundColor: colors.surface.cream,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  inputWrapperFocused: {
    borderColor: colors.brand.DEFAULT,
  },
  inputWrapperError: {
    borderColor: colors.danger,
  },
  leading: {
    marginRight: 10,
  },
  trailing: {
    marginLeft: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    color: colors.ink,
    paddingVertical: 12,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '500',
    flex: 1,
  },
  hintText: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 6,
  },
});
