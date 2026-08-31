import { lazy, Suspense } from 'react';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet, IonSpinner } from '@ionic/react';
import { Route, Redirect } from 'react-router-dom';
import { home, people, list, settings } from 'ionicons/icons';

const Dashboard = lazy(() => import('../pages/Dashboard'));
const Utilisateurs = lazy(() => import('../pages/Utilisateurs'));
const Journal = lazy(() => import('../pages/Journal'));
const Settings = lazy(() => import('../pages/Settings'));

function TabLoader() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
      <IonSpinner name="crescent" />
    </div>
  );
}

export default function TabLayout() {
  return (
    <IonTabs>
      <IonRouterOutlet>
        <Suspense fallback={<TabLoader />}>
          <Route path="/tab/dashboard" component={Dashboard} exact />
          <Route path="/tab/utilisateurs" component={Utilisateurs} exact />
          <Route path="/tab/journal" component={Journal} exact />
          <Route path="/tab/settings" component={Settings} exact />
        </Suspense>
        <Route path="/tab" render={() => <Redirect to="/tab/dashboard" />} exact />
      </IonRouterOutlet>

      <IonTabBar slot="bottom">
        <IonTabButton tab="dashboard" href="/tab/dashboard">
          <IonIcon icon={home} />
          <IonLabel>Accueil</IonLabel>
        </IonTabButton>
        <IonTabButton tab="utilisateurs" href="/tab/utilisateurs">
          <IonIcon icon={people} />
          <IonLabel>Users</IonLabel>
        </IonTabButton>
        <IonTabButton tab="journal" href="/tab/journal">
          <IonIcon icon={list} />
          <IonLabel>Journal</IonLabel>
        </IonTabButton>
        <IonTabButton tab="settings" href="/tab/settings">
          <IonIcon icon={settings} />
          <IonLabel>Profil</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}
