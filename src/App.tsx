import { lazy, Suspense } from 'react';
import { Redirect, Route, Switch } from 'react-router-dom';
import { IonApp, IonRouterOutlet, IonSpinner, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { AuthProvider, useAuth } from './context/AuthContext';

const Login = lazy(() => import('./pages/Login'));
const TabLayout = lazy(() => import('./components/TabLayout'));

setupIonicReact();

function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#f9fafb',
      }}>
        <IonSpinner name="crescent" color="primary" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Redirect to="/login" />;
  }

  return <TabLayout />;
}

export default function App() {
  return (
    <IonApp>
      <AuthProvider>
        <IonReactRouter>
          <Suspense fallback={
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
              <IonSpinner name="crescent" />
            </div>
          }>
            <Switch>
              <Route path="/login" component={Login} exact />
              <Route path="/tab" component={AuthGuard} />
              <Route path="*" render={() => <Redirect to="/tab/dashboard" />} />
            </Switch>
          </Suspense>
        </IonReactRouter>
      </AuthProvider>
    </IonApp>
  );
}
