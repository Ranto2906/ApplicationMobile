import { Redirect, Route } from 'react-router-dom';
import { IonApp, IonRouterOutlet, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { AuthProvider, useAuth } from './context/AuthContext';

/* Pages */
import Login from './pages/Login';
import TabLayout from './components/TabLayout';
import Dashboard from './pages/Dashboard';
import Utilisateurs from './pages/Utilisateurs';
import Journal from './pages/Journal';
import Settings from './pages/Settings';

setupIonicReact();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Redirect to="/login" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <IonApp>
      <AuthProvider>
        <IonReactRouter>
          <IonRouterOutlet>
            {/* Public */}
            <Route path="/login" component={Login} exact />

            {/* Protected */}
            <Route path="/" render={() => (
              <ProtectedRoute>
                <TabLayout />
              </ProtectedRoute>
            )}>
              <Route path="/" exact render={() => <Redirect to="/tab/dashboard" />} />
              <Route path="/tab/dashboard" component={Dashboard} exact />
              <Route path="/tab/utilisateurs" component={Utilisateurs} exact />
              <Route path="/tab/journal" component={Journal} exact />
              <Route path="/tab/settings" component={Settings} exact />
            </Route>

            <Route path="*" render={() => <Redirect to="/tab/dashboard" />} />
          </IonRouterOutlet>
        </IonReactRouter>
      </AuthProvider>
    </IonApp>
  );
}
