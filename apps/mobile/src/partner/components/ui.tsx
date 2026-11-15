import { useState } from 'react';
import { View, Text, Pressable, TextInput, Modal, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, X, Check, Search, Menu } from 'lucide-react-native';
import { colors } from '@/constants/colors';
import { usePartnerT } from '@/partner/lib/i18n';
import PartnerNavDrawer from '@/partner/components/PartnerNavDrawer';

/**
 * The chrome every partner list screen repeats: a back header, a search box,
 * a row of filter chips, a bottom-sheet picker, and a pager.
 *
 * Extracted when the second screen needed them rather than the first — the
 * riders screen still keeps its own copies of the two smallest pieces, which
 * is fine; the point here is the three substantial ones (PickerSheet,
 * FilterChips, Pager), where a second divergent copy would be a real bug
 * surface. Web's equivalents live in partner/components/ for the same reason.
 *
 * These read `usePartnerT` themselves instead of taking a `t` prop. Every
 * caller is inside partner mode, and threading the same translator through
 * five components only creates a chance to pass the wrong one.
 */

/**
 * The partner app bar, for the four TAB screens.
 *
 * Deliberately the customer AppHeader's design — brand blue owning the
 * status-bar inset, a 60pt control row, translucent circular buttons, the
 * C-mark — so partner mode reads as the same app in a different job rather
 * than a second app bolted on. What it drops is what a shopkeeper has no use
 * for: the search pill, the cart, and the location row.
 *
 * The menu button opens PartnerNavDrawer, which replaced a "More" tab. The
 * drawer lives here rather than in the layout, for AppHeader's reason: every
 * screen that renders the bar gets the drawer with it, and being a Modal it
 * escapes this row's bounds.
 *
 * On the status bar: RN keeps a stack of StatusBar entries, applies the last
 * mounted and restores the previous on unmount, so a pushed partner screen's
 * cream header reverts to this blue on the way back without either side
 * coordinating.
 */
export function PartnerTabBar({
  title, right,
}: {
  title: string;
  /** Actions that belong to the screen as a whole, e.g. "Add product". */
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const t = usePartnerT();
  const [navOpen, setNavOpen] = useState(false);

  return (
    <View style={{ backgroundColor: colors.brand.DEFAULT, paddingTop: insets.top }}>
      <StatusBar style="light" backgroundColor={colors.brand.DEFAULT} />

      <View style={{
        minHeight: 60, paddingHorizontal: 12, paddingVertical: 8,
        flexDirection: 'row', alignItems: 'center', gap: 10,
      }}>
        <Pressable
          onPress={() => setNavOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={t('drawer.open')}
          style={{
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: 'rgba(255,255,255,0.10)',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Menu size={18} color="#fff" strokeWidth={2.25} />
        </Pressable>

        {/* One line, no eyebrow above it. A small-caps label stacked over the
            title was saying what the tab bar already says, and it made the bar
            look like it carried two pieces of information when it carried one. */}
        <Text
          numberOfLines={1}
          style={{
            flex: 1, minWidth: 0,
            fontSize: 19, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.4,
          }}
        >
          {title}
        </Text>

        {right}
      </View>

      <PartnerNavDrawer open={navOpen} onClose={() => setNavOpen(false)} />
    </View>
  );
}

export function PartnerHeader({
  title, subtitle, onBack, right, children,
}: {
  title: string;
  subtitle?: string | null;
  onBack: () => void;
  /** Screen-level action sitting opposite the back button. */
  right?: React.ReactNode;
  /** Search boxes, chip rows — anything that scrolls with the title block. */
  children?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={{
      paddingHorizontal: 12, paddingTop: insets.top + 10, paddingBottom: 10,
      backgroundColor: colors.surface.cream,
      borderBottomWidth: 1, borderBottomColor: colors.border, gap: 10,
    }}>
      <StatusBar style="dark" backgroundColor={colors.surface.cream} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}
        >
          <ArrowLeft size={21} color={colors.ink} strokeWidth={2} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={{ fontSize: 12, color: colors.muted }}>{subtitle}</Text>}
        </View>
        {right}
      </View>
      {children}
    </View>
  );
}

export function SearchField({
  value, onChangeText, placeholder,
}: {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}) {
  return (
    <View style={{
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: colors.surface.linen, borderWidth: 1, borderColor: colors.border,
      borderRadius: 10, paddingHorizontal: 10, minHeight: 42,
    }}>
      <Search size={15} color={colors.muted} strokeWidth={1.75} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        style={{ flex: 1, fontSize: 13.5, color: colors.ink }}
      />
      {value.length > 0 && (
        <Pressable onPress={() => onChangeText('')} hitSlop={8}>
          <X size={15} color={colors.muted} strokeWidth={2} />
        </Pressable>
      )}
    </View>
  );
}

/**
 * Horizontal chips, scrollable. Web uses underline tabs for the same job;
 * they do not fit eight statuses on a phone, and chips can scroll without
 * looking broken.
 */
export function FilterChips<T extends string>({
  options, value, labelFor, onChange,
}: {
  options: readonly T[];
  value: T;
  labelFor: (option: T) => string;
  onChange: (next: T) => void;
}) {
  return (
    <View style={{ marginHorizontal: -12 }}>
      <FlatList
        horizontal
        showsHorizontalScrollIndicator={false}
        data={options as T[]}
        keyExtractor={(o) => o}
        contentContainerStyle={{ paddingHorizontal: 12, gap: 6, alignItems: 'center' }}
        renderItem={({ item }) => {
          const on = value === item;
          return (
            <Pressable
              onPress={() => onChange(item)}
              style={{
                minHeight: 32, paddingHorizontal: 12, borderRadius: 999,
                alignItems: 'center', justifyContent: 'center',
                backgroundColor: on ? colors.brand.DEFAULT : colors.surface.linen,
                borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
              }}
            >
              <Text style={{ fontSize: 12.5, fontWeight: on ? '700' : '500', color: on ? '#FFFFFF' : colors.gray }}>
                {labelFor(item)}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}

export interface PickerOption {
  key: string;
  label: string;
  /** Renders in the danger tone — destructive or terminal choices. */
  danger?: boolean;
}

/**
 * A bottom sheet standing in for web's `<select>`. Options are tap targets at
 * 52pt rather than menu rows, since this is reached one-handed.
 */
export function PickerSheet({
  visible, title, options, selectedKey, emptyLabel, onPick, onClose,
}: {
  visible: boolean;
  title: string;
  options: PickerOption[];
  selectedKey?: string;
  emptyLabel?: string;
  onPick: (key: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.45)' }} onPress={onClose} />
      <View style={{
        backgroundColor: colors.surface.cream,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 20, paddingBottom: 32, gap: 6, maxHeight: '70%',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}>
            <X size={19} color={colors.muted} strokeWidth={2} />
          </Pressable>
        </View>
        {options.length === 0 ? (
          <Text style={{ fontSize: 13, color: colors.muted, paddingVertical: 12 }}>{emptyLabel}</Text>
        ) : (
          <FlatList
            data={options}
            keyExtractor={(o) => o.key}
            contentContainerStyle={{ gap: 6 }}
            renderItem={({ item }) => {
              const on = selectedKey === item.key;
              return (
                <Pressable
                  onPress={() => onPick(item.key)}
                  style={{
                    flexDirection: 'row', alignItems: 'center', gap: 10,
                    minHeight: 52, paddingHorizontal: 14, borderRadius: 12,
                    backgroundColor: on ? colors.brand.mist : colors.surface.linen,
                    borderWidth: 1, borderColor: on ? colors.brand.DEFAULT : colors.border,
                  }}
                >
                  <Text style={{
                    flex: 1, fontSize: 14.5, fontWeight: on ? '700' : '600',
                    color: item.danger ? colors.danger : on ? colors.brand.deepest : colors.ink,
                  }}>
                    {item.label}
                  </Text>
                  {on && <Check size={16} color={colors.brand.DEFAULT} strokeWidth={2.5} />}
                </Pressable>
              );
            }}
          />
        )}
      </View>
    </Modal>
  );
}

/** Prev / "3 of 9" / Next. Renders nothing when there is only one page. */
export function Pager({
  page, totalPages, onChange,
}: {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
}) {
  const t = usePartnerT();
  if (totalPages <= 1) return null;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, paddingTop: 16 }}>
      <PagerButton label={t('partnerUi.prev')} disabled={page <= 1} onPress={() => onChange(page - 1)} />
      <Text style={{ fontSize: 12.5, color: colors.muted }}>
        {t('partnerUi.pageOf').replace('{{a}}', String(page)).replace('{{b}}', String(totalPages))}
      </Text>
      <PagerButton label={t('partnerUi.next')} disabled={page >= totalPages} onPress={() => onChange(page + 1)} />
    </View>
  );
}

function PagerButton({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={{
        minHeight: 40, paddingHorizontal: 16, borderRadius: 10,
        alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface.cream,
        opacity: disabled ? 0.4 : 1,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: colors.ink }}>{label}</Text>
    </Pressable>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 }}>
      {children}
    </View>
  );
}

export function PrimaryButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        minHeight: 44, paddingHorizontal: 20, borderRadius: 12,
        backgroundColor: colors.brand.DEFAULT, alignItems: 'center', justifyContent: 'center',
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#FFFFFF' }}>{label}</Text>
    </Pressable>
  );
}

export function StatusPill({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ fontSize: 10, fontWeight: '700', color: fg }}>{label}</Text>
    </View>
  );
}
