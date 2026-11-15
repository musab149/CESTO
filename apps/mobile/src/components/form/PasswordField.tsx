import { forwardRef, useState } from 'react';
import { TouchableOpacity, type TextInput } from 'react-native';
import { Lock, Eye, EyeOff } from 'lucide-react-native';
import TextInputField, { type TextInputFieldProps } from './TextInputField';
import { colors } from '../../constants/colors';

export interface PasswordFieldProps
  extends Omit<TextInputFieldProps, 'secureTextEntry' | 'leadingIcon' | 'trailing'> {
  hideLockIcon?: boolean;
}

const PasswordField = forwardRef<TextInput, PasswordFieldProps>(function PasswordField(
  { hideLockIcon, ...props }, ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <TextInputField
      ref={ref}
      autoCapitalize="none"
      secureTextEntry={!visible}
      leadingIcon={
        hideLockIcon ? undefined : (
          <Lock size={18} color={colors.muted} strokeWidth={1.75} />
        )
      }
      trailing={
        <TouchableOpacity
          onPress={() => setVisible((v) => !v)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
        >
          {visible
            ? <EyeOff size={20} color={colors.muted} strokeWidth={1.75} />
            : <Eye size={20} color={colors.muted} strokeWidth={1.75} />}
        </TouchableOpacity>
      }
      {...props}
    />
  );
});

export default PasswordField;
