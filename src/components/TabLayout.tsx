import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet } from '@ionic/react';
import { Route, Redirect, useLocation } from 'react-router-dom';
import { home, people, list, settings } from 'ionicons/icons';

import Dashboard from '../pages/Dashboard';
import Utilisateurs from '../pages/Utilisateurs';
import Journal from '../pages/Journal';
import Settings from '../pages/Settings';

export default function TabLayout() {
  const location = useLocation();

  return (
    <IonTabs>
      <IonRouterOutlet>
        <Route path="/tab/dashboard" component={Dashboard} exact />
        <Route path="/tab/utilisateurs" component={Utilisateurs} exact />
        <Route path="/tab/journal" component={Journal} exact />
        <Route path="/tab/settings" component={Settings} exact />
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
