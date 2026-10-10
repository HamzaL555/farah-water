import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from 'react-native-paper';
import { useAuth } from '../context/AuthContext';
import { LoginScreen } from '../screens/LoginScreen';
import { WorkerHomeScreen } from '../screens/WorkerHomeScreen';
import { NewDeliveryScreen } from '../screens/NewDeliveryScreen';
import { CustomersScreen } from '../screens/CustomersScreen';
import { CustomerDetailScreen } from '../screens/CustomerDetailScreen';
import { DebtsScreen } from '../screens/DebtsScreen';
import { BottlesScreen } from '../screens/BottlesScreen';
import { HistoryScreen } from '../screens/HistoryScreen';
import { DeliveryDetailScreen } from '../screens/DeliveryDetailScreen';
import { ProfileScreen } from '../screens/ProfileScreen';
import { ChangePasswordScreen } from '../screens/ChangePasswordScreen';
import { AdminHomeScreen } from '../screens/AdminHomeScreen';
import { WorkersScreen } from '../screens/WorkersScreen';
import { WorkerFormScreen } from '../screens/WorkerFormScreen';
import { WorkerDetailScreen } from '../screens/WorkerDetailScreen';
import { RevenueScreen } from '../screens/RevenueScreen';
import { AdminDeliveriesScreen } from '../screens/AdminDeliveriesScreen';
import { WarehouseScreen } from '../screens/WarehouseScreen';
import { ReportsScreen } from '../screens/ReportsScreen';
import { AuditLogScreen } from '../screens/AuditLogScreen';
import { colors } from '../theme';
import type { AdminStackParamList, AdminTabParamList, WorkerStackParamList, WorkerTabParamList } from './types';

const WorkerTab = createBottomTabNavigator<WorkerTabParamList>();
const WorkerStack = createNativeStackNavigator<WorkerStackParamList>();
const AdminTab = createBottomTabNavigator<AdminTabParamList>();
const AdminStack = createNativeStackNavigator<AdminStackParamList>();

/** Simple text glyphs keep the bundle free of an icon-font dependency. */
const TabIcon: React.FC<{ glyph: string; focused: boolean }> = ({ glyph, focused }) => (
  <View style={styles.tabIconWrap}>
    <View style={[styles.tabIcon, focused && styles.tabIconActive]}>
      <View style={[styles.tabDot, { backgroundColor: focused ? colors.white : colors.textMuted }]} />
      <View style={[styles.tabDot, { backgroundColor: focused ? colors.white : colors.textMuted }]} />
      <View style={[styles.tabDot, { backgroundColor: focused ? colors.white : colors.textMuted }]} />
    </View>
  </View>
);

const WorkerTabs: React.FC = () => (
  <WorkerTab.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: colors.primary },
      headerTitleStyle: { color: colors.white, fontWeight: '700' },
      headerTintColor: colors.white,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 58, paddingBottom: 6 },
      tabBarLabelStyle: { fontSize: 10 },
    }}
  >
    <WorkerTab.Screen
      name="Home"
      component={WorkerHomeScreen}
      options={{ title: 'Ana səhifə', tabBarIcon: ({ focused }) => <TabIcon glyph="home" focused={focused} /> }}
    />
    <WorkerTab.Screen
      name="NewDelivery"
      component={NewDeliveryScreen}
      options={{ title: 'Yeni çatdırılma', tabBarIcon: ({ focused }) => <TabIcon glyph="plus" focused={focused} /> }}
    />
    <WorkerTab.Screen name="Customers" component={CustomersScreen} options={{ title: 'Müştərilər' }} />
    <WorkerTab.Screen name="Debts" component={DebtsScreen} options={{ title: 'Borc' }} />
    <WorkerTab.Screen name="Bottles" component={BottlesScreen} options={{ title: 'Bidonlar' }} />
    <WorkerTab.Screen name="History" component={HistoryScreen} options={{ title: 'Tarixçə' }} />
    <WorkerTab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profil' }} />
  </WorkerTab.Navigator>
);

const WorkerNavigation: React.FC = () => (
  <WorkerStack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: colors.primary },
      headerTitleStyle: { color: colors.white },
      headerTintColor: colors.white,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <WorkerStack.Screen name="WorkerTabs" component={WorkerTabs} options={{ headerShown: false }} />
    <WorkerStack.Screen name="DeliveryDetail" component={DeliveryDetailScreen} options={{ title: 'Çatdırılma' }} />
    <WorkerStack.Screen name="CustomerDetail" component={CustomerDetailScreen} options={{ title: 'Müştəri' }} />
    <WorkerStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Şifrəni dəyiş' }} />
  </WorkerStack.Navigator>
);

const AdminTabs: React.FC = () => (
  <AdminTab.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: colors.primary },
      headerTitleStyle: { color: colors.white, fontWeight: '700' },
      headerTintColor: colors.white,
      tabBarActiveTintColor: colors.primary,
      tabBarInactiveTintColor: colors.textMuted,
      tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 58, paddingBottom: 6 },
      tabBarLabelStyle: { fontSize: 10 },
    }}
  >
    <AdminTab.Screen name="AdminHome" component={AdminHomeScreen} options={{ title: 'Dashboard', tabBarIcon: ({ focused }) => <TabIcon glyph="home" focused={focused} /> }} />
    <AdminTab.Screen name="Workers" component={WorkersScreen} options={{ title: 'İşçilər' }} />
    <AdminTab.Screen name="Debts" component={DebtsScreen} options={{ title: 'Borclar' }} />
    <AdminTab.Screen name="Revenue" component={RevenueScreen} options={{ title: 'Gəlirlər' }} />
    <AdminTab.Screen name="Deliveries" component={AdminDeliveriesScreen} options={{ title: 'Çatdırılma' }} />
    <AdminTab.Screen name="Warehouse" component={WarehouseScreen} options={{ title: 'Anbar' }} />
    <AdminTab.Screen name="Reports" component={ReportsScreen} options={{ title: 'Hesabat' }} />
    <AdminTab.Screen name="AuditLog" component={AuditLogScreen} options={{ title: 'Audit' }} />
    <AdminTab.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profil' }} />
  </AdminTab.Navigator>
);

const AdminNavigation: React.FC = () => (
  <AdminStack.Navigator
    screenOptions={{
      headerStyle: { backgroundColor: colors.primary },
      headerTitleStyle: { color: colors.white },
      headerTintColor: colors.white,
      contentStyle: { backgroundColor: colors.background },
    }}
  >
    <AdminStack.Screen name="AdminTabs" component={AdminTabs} options={{ headerShown: false }} />
    <AdminStack.Screen name="DeliveryDetail" component={DeliveryDetailScreen} options={{ title: 'Çatdırılma' }} />
    <AdminStack.Screen name="CustomerDetail" component={CustomerDetailScreen} options={{ title: 'Müştəri' }} />
    <AdminStack.Screen name="WorkerDetail" component={WorkerDetailScreen} options={{ title: 'İşçi profili' }} />
    <AdminStack.Screen name="WorkerForm" component={WorkerFormScreen} options={{ title: 'İşçi hesabı' }} />
    <AdminStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Şifrəni dəyiş' }} />
  </AdminStack.Navigator>
);

/** Role-based root switch: admin and worker get entirely different navigators. */
export const RootNavigator: React.FC = () => {
  const { user, booting } = useAuth();
  const paperTheme = useTheme();

  const navTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.surface,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };

  if (booting) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {!user ? <LoginScreen /> : user.role === 'ADMIN' ? <AdminNavigation /> : <WorkerNavigation />}
    </NavigationContainer>
  );
};

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  tabIconWrap: { alignItems: 'center', justifyContent: 'center' },
  tabIcon: {
    width: 20,
    height: 18,
    borderRadius: 4,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 2,
    opacity: 0.9,
  },
  tabIconActive: { backgroundColor: colors.primary },
  tabDot: { width: 3, height: 3, borderRadius: 2 },
});
