import React from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useTheme } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../context/AuthContext';
import { TabIcon } from '../components/TabIcon';
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
import { PricesScreen } from '../screens/PricesScreen';
import { ExpensesScreen } from '../screens/ExpensesScreen';
import { DepositsScreen } from '../screens/DepositsScreen';
import { colors } from '../theme';
import type { AdminStackParamList, AdminTabParamList, WorkerStackParamList, WorkerTabParamList } from './types';

const WorkerTab = createBottomTabNavigator<WorkerTabParamList>();
const WorkerStack = createNativeStackNavigator<WorkerStackParamList>();
const AdminTab = createBottomTabNavigator<AdminTabParamList>();
const AdminStack = createNativeStackNavigator<AdminStackParamList>();

/** Icon tint for a tab sitting on the primary-coloured bar. */
const ACTIVE_TINT = colors.white;
const INACTIVE_TINT = '#BBD7E8';

/**
 * Tabs render at the TOP, directly under the screen header.
 * `tabBarPosition: 'top'` + `tabBarLabelPosition: 'below-icon'` puts the icon
 * above the label, which is how operators scan the bar.
 */
const tabScreenOptions = {
  tabBarPosition: 'top' as const,
  tabBarLabelPosition: 'below-icon' as const,
  headerStyle: { backgroundColor: colors.primary },
  headerTitleStyle: { color: colors.white, fontWeight: '700' as const },
  headerTintColor: colors.white,
  tabBarActiveTintColor: ACTIVE_TINT,
  tabBarInactiveTintColor: INACTIVE_TINT,
  tabBarStyle: {
    backgroundColor: colors.primary,
    borderBottomColor: colors.primaryDark,
    borderBottomWidth: 1,
    elevation: 3,
  },
  tabBarLabelStyle: { fontSize: 10, fontWeight: '600' as const, marginTop: 0, marginBottom: 6 },
  tabBarIconStyle: { marginTop: 0, marginBottom: 0 },
  tabBarItemStyle: { paddingVertical: 6 },
} as const;

const WorkerTabs: React.FC = () => {
  const { user } = useAuth();
  // A regular worker only ever sees their own bottles; the anbardar sees the
  // warehouse. The tab label says which, so nobody opens it expecting the other.
  const isKeeper = user?.workerType === 'WAREHOUSE_KEEPER';
  const bottlesTitle = isKeeper ? 'Anbar' : 'Bidonlarım';
  return (
  <WorkerTab.Navigator screenOptions={tabScreenOptions}>
    <WorkerTab.Screen
      name="Home"
      component={WorkerHomeScreen}
      options={{
        title: 'Ana səhifə',
        tabBarIcon: ({ focused, color }) => <TabIcon name="home" color={color} focused={focused} />,
      }}
    />
    <WorkerTab.Screen
      name="NewDelivery"
      component={NewDeliveryScreen}
      options={{
        title: 'Yeni çatdırılma',
        tabBarLabel: 'Çatdırılma',
        tabBarIcon: ({ focused, color }) => <TabIcon name="plus-circle" color={color} focused={focused} />,
      }}
    />
    <WorkerTab.Screen
      name="Customers"
      component={CustomersScreen}
      options={{
        title: 'Müştərilər',
        tabBarIcon: ({ focused, color }) => <TabIcon name="account-group" color={color} focused={focused} />,
      }}
    />
    <WorkerTab.Screen
      name="Debts"
      component={DebtsScreen}
      options={{
        title: 'Borc',
        tabBarIcon: ({ focused, color }) => <TabIcon name="alert-circle" color={color} focused={focused} />,
      }}
    />
    {/* The worker runs the warehouse from here: receives, takes, returns.
        A regular worker sees only their own balance and cannot touch the
        warehouse at all. */}
    <WorkerTab.Screen
      name="Bottles"
      component={BottlesScreen}
      options={{
        title: bottlesTitle,
        tabBarLabel: bottlesTitle,
        tabBarIcon: ({ focused, color }) => <TabIcon name="bottle-soda-outline" color={color} focused={focused} />,
      }}
    />
    <WorkerTab.Screen
      name="History"
      component={HistoryScreen}
      options={{
        title: 'Tarixçə',
        tabBarIcon: ({ focused, color }) => <TabIcon name="history" color={color} focused={focused} />,
      }}
    />
    <WorkerTab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{
        title: 'Profil',
        tabBarIcon: ({ focused, color }) => <TabIcon name="account" color={color} focused={focused} />,
      }}
    />
  </WorkerTab.Navigator>
  );
};

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
    <WorkerStack.Screen name="Prices" component={PricesScreen} options={{ title: 'Qiymətlər' }} />
    <WorkerStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Şifrəni dəyiş' }} />
  </WorkerStack.Navigator>
);

const AdminTabs: React.FC = () => (
  <AdminTab.Navigator screenOptions={tabScreenOptions}>
    <AdminTab.Screen
      name="AdminHome"
      component={AdminHomeScreen}
      options={{
        title: 'Dashboard',
        tabBarIcon: ({ focused, color }) => <TabIcon name="view-dashboard" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Workers"
      component={WorkersScreen}
      options={{
        title: 'İşçilər',
        tabBarIcon: ({ focused, color }) => <TabIcon name="account-group" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Debts"
      component={DebtsScreen}
      options={{
        title: 'Borclar',
        tabBarIcon: ({ focused, color }) => <TabIcon name="cash-multiple" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Revenue"
      component={RevenueScreen}
      options={{
        title: 'Gəlirlər',
        tabBarIcon: ({ focused, color }) => <TabIcon name="chart-bar" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Deliveries"
      component={AdminDeliveriesScreen}
      options={{
        title: 'Çatdırılma',
        tabBarIcon: ({ focused, color }) => <TabIcon name="truck-delivery-outline" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Warehouse"
      component={WarehouseScreen}
      options={{
        title: 'Anbar',
        tabBarIcon: ({ focused, color }) => <TabIcon name="warehouse" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Reports"
      component={ReportsScreen}
      options={{
        title: 'Hesabat',
        tabBarIcon: ({ focused, color }) => <TabIcon name="file-chart" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="AuditLog"
      component={AuditLogScreen}
      options={{
        title: 'Audit',
        tabBarIcon: ({ focused, color }) => <TabIcon name="shield-check" color={color} focused={focused} />,
      }}
    />
    <AdminTab.Screen
      name="Profile"
      component={ProfileScreen}
      options={{
        title: 'Profil',
        tabBarIcon: ({ focused, color }) => <TabIcon name="account" color={color} focused={focused} />,
      }}
    />
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
    <AdminStack.Screen name="Prices" component={PricesScreen} options={{ title: 'Qiymətlər' }} />
    <AdminStack.Screen name="Expenses" component={ExpensesScreen} options={{ title: 'Xərclər' }} />
    <AdminStack.Screen name="Deposits" component={DepositsScreen} options={{ title: 'Depozitlər' }} />
    <AdminStack.Screen name="ChangePassword" component={ChangePasswordScreen} options={{ title: 'Şifrəni dəyiş' }} />
  </AdminStack.Navigator>
);

/** Role-based root switch: admin and worker get entirely different navigators. */
export const RootNavigator: React.FC = () => {
  const { user, booting } = useAuth();
  useTheme(); // ensures Paper's theme context is resolved before first render

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
      <SafeAreaView style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </SafeAreaView>
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
});
