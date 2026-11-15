import { forwardRef, type ReactNode } from 'react';
import { Pressable, View, Text, StyleSheet } from 'react-native';
import { Check, AlertCircle } from 'lucide-react-native';
import { colors } from '../../constants/colors';

export interface CheckboxProps {
  label: ReactNode;
  value: boolean;
  onChange: (next: boolean) => void;
  onBlur?: () => void;
  error?: string;
  /** Mirrors register()'s `name` prop so RHF's Controller integration stays clean. */
  name?: string;
}

const Checkbox = forwardRef<View, CheckboxProps>(function Checkbox(
  { label, value, onChange, onBlur, error }, ref,
) {
  return (
    <View ref={ref} style={styles.group}>
      <Pressable
        onPress={() => { onChange(!value); onBlur?.(); }}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value }}
        style={styles.row}
      >
        <View style={[
          styles.box,
          value && styles.boxChecked,
          !!error && styles.boxError,
        ]}>
          {value && <Check size={12} color="#fff" strokeWidth={3} />}
        </View>
        {typeof label === 'string'
          ? <Text style={styles.label}>{label}</Text>
          : label}
      </Pressable>
      {error && (
        <View style={styles.errorRow}>
          <AlertCircle size={12} color={colors.danger} strokeWidth={2} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
});

export default Checkbox;

const styles = StyleSheet.create({
  group: { marginBottom: 14 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface.cream,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  boxChecked: {
    backgroundColor: colors.brand.DEFAULT,
    borderColor: colors.brand.DEFAULT,
  },
  boxError: {
    borderColor: colors.danger,
  },
  label: {
    fontSize: 13,
    color: colors.ink,
    flex: 1,
    lineHeight: 18,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginLeft: 30,
  },
  errorText: {
    fontSize: 12,
    color: colors.danger,
    fontWeight: '500',
    flex: 1,
  },
});
