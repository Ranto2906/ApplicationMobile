import { Component, lazy, Suspense } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Redirect, Route, Switch } from 'react-router-dom';
import { IonApp, IonRouterOutlet, IonSpinner, setupIonicReact } from '@ionic/react';
import { IonReactRouter } from '@ionic/react-router';
import { AuthProvider, useAuth } from './context/AuthContext';

const Login = lazy(() => import('./pages/Login'));
const TabLayout = lazy(() => import('./components/TabLayout'));

setupIonicReact();

interface ErrorBoundaryState { error: Error | null }

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[SEIMAD] erreur de rendu', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', padding: 24, display: 'flex', flexDirection: 'column',
        justifyContent: 'center', fontFamily: 'sans-serif', background: '#f8fafc', color: '#1f2937',
      }}>
        <h1 style={{ margin: '0 0 12px', fontSize: 22 }}>SEIMAD ne peut pas afficher cet écran</h1>
        <p style={{ margin: '0 0 20px', lineHeight: 1.5 }}>
          Vérifiez que les données locales sont disponibles, puis redémarrez l'application.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          style={{ alignSelf: 'flex-start', padding: '10px 16px', border: 0, borderRadius: 8, background: '#176b87', color: 'white' }}
        >
          Redémarrer
        </button>
      </div>
    );
  }
}

function AuthGuard() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#f4f8fa',
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
    <ErrorBoundary>
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
    </ErrorBoundary>
  );
}
