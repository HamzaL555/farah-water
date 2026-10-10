import type { NavigatorScreenParams } from '@react-navigation/native';

// ------------------------------- worker ------------------------------------

export type WorkerTabParamList = {
  Home: undefined;
  NewDelivery: undefined;
  Customers: undefined;
  Debts: undefined;
  Bottles: undefined;
  History: { focusId?: string } | undefined;
  Profile: undefined;
};

export type WorkerStackParamList = {
  WorkerTabs: NavigatorScreenParams<WorkerTabParamList>;
  DeliveryDetail: { deliveryId: string };
  /** Customer profile, reachable from both the customer list and debt rows. */
  CustomerDetail: { customerId: string };
  PaymentHistory: { deliveryId: string };
  ChangePassword: undefined;
  PendingOperations: undefined;
};

// -------------------------------- admin ------------------------------------

export type AdminTabParamList = {
  AdminHome: undefined;
  Workers: undefined;
  Debts: undefined;
  Revenue: undefined;
  Deliveries: undefined;
  Warehouse: undefined;
  Reports: undefined;
  AuditLog: undefined;
  Profile: undefined;
};

export type AdminStackParamList = {
  AdminTabs: NavigatorScreenParams<AdminTabParamList>;
  // Detail screens shared with the worker flow.
  DeliveryDetail: { deliveryId: string };
  PaymentHistory: { deliveryId: string };
  WorkerDetail: { workerId: string; workerName: string };
  WorkerForm: { workerId?: string } | undefined;
  CustomerDetail: { customerId: string };
  Settings: undefined;
  ChangePassword: undefined;
  PendingOperations: undefined;
};
