import { Tabs } from 'expo-router';
/**
 * Selected tabs use the filled variant of their icon.
 *
 * Lucide ships one outline glyph per icon rather than an outline/solid pair,
 * so "filled" is the same glyph with `fill` set to the active colour.
 * createLucideIcon spreads unrecognised props onto both the <Svg> and every
 * child path, and none of the paths declare their own `fill`, so the single
 * prop paints the whole shape. `fill="none"` is the library default and is
 * what the unselected state falls back to.
 */
import { Home, ShoppingBasket, Store, User } from 'lucide-react-native';
import { useLanguageStore } from '../../src/stores/languageStore';
import { colors } from '../../src/constants/colors';
import { useTabBarLayout } from '../../src/lib/tabBar';
import { View } from 'react-native';

export default function TabLayout() {
  const { t } = useLanguageStore();
  const tabBar = useTabBarLayout();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Without this the keyboard shoves the bar up over the field being
        // typed into — worst on exactly the short screens this already hurt.
        tabBarHideOnKeyboard: true,
        tabBarShowLabel: tabBar.showLabel,
        tabBarStyle: {
          ...tabBar.style,
          backgroundColor: colors.surface.cream,
          borderTopColor: colors.border,
          borderTopWidth: 0.5,
          elevation: 0,
          shadowColor: '#0F172A',
          shadowOpacity: 0.04,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: -2 },
        },
        // brand.DEFAULT (#054EE8), not brand.deepest (#022B91) — deepest is the
        // navy used for depth behind the brand, not the brand blue itself.
        tabBarActiveTintColor: colors.brand.DEFAULT,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: {
          fontFamily: 'PlusJakartaSans',
          fontSize: 10.5,
          fontWeight: '600',
          letterSpacing: -0.2,
          marginTop: 2,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tab.home'),
          tabBarIcon: ({ color, size, focused }) => (
            <Home size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
      <Tabs.Screen
        name="categories"
        options={{
          title: t('tab.categories'),
          tabBarIcon: ({ color, size, focused }) => (
            <View style={{ width: size, height: size, justifyContent: 'center', alignItems: 'center' }}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, width: 18, height: 18 }}>
                {[0, 1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: 2,
                      backgroundColor: focused ? color : 'transparent',
                      borderWidth: focused ? 0 : 1.5,
                      borderColor: color,
                    }}
                  />
                ))}
              </View>
            </View>
          ),
        }}
      />
      {/* Stores took this slot. The route stays registered — the home search
          pill and AppHeader both push /(tabs)/search — but href:null keeps it
          off the bar. */}
      <Tabs.Screen name="search" options={{ href: null }} />
      <Tabs.Screen
        name="stores"
        options={{
          title: t('tab.stores'),
          tabBarIcon: ({ color, size, focused }) => (
            <Store size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
      <Tabs.Screen
        name="rashan"
        options={{
          title: t('tab.rashan'),
          tabBarIcon: ({ color, size, focused }) => (
            <ShoppingBasket size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: t('tab.profile'),
          tabBarIcon: ({ color, size, focused }) => (
            <User size={size} color={color} strokeWidth={1.75} fill={focused ? color : 'none'} />
          ),
        }}
      />
    </Tabs>
  );
}
