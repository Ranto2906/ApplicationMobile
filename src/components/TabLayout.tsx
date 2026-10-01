import { lazy, Suspense } from 'react';
import { IonTabs, IonTabBar, IonTabButton, IonIcon, IonLabel, IonRouterOutlet, IonSpinner } from '@ionic/react';
import { Route, Redirect } from 'react-router-dom';
import { home, megaphone, clipboardOutline, settings } from 'ionicons/icons';

const Dashboard = lazy(() => import('../pages/Dashboard'));
const SignalementsList = lazy(() => import('../pages/signalements/SignalementsList'));
const SignalementCreate = lazy(() => import('../pages/signalements/SignalementCreate'));
const SignalementDetail = lazy(() => import('../pages/signalements/SignalementDetail'));
const DescenteTerrainList = lazy(() => import('../pages/descente-terrain/DescenteTerrainList'));
const DescenteTerrainCreate = lazy(() => import('../pages/descente-terrain/DescenteTerrainCreate'));
const DescenteTerrainDetail = lazy(() => import('../pages/descente-terrain/DescenteTerrainDetail'));
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
          <Route path="/tab/signalements" component={SignalementsList} exact />
          <Route
            path="/tab/signalements/nouveau"
            exact
            component={SignalementCreate}
          />
          {/* Édition : même formulaire que la création, pré-rempli (mode `modifier`). */}
          <Route
            path="/tab/signalements/modifier/:id"
            exact
            render={({ match }) => {
              const { id } = match.params as { id: string };
              return <SignalementCreate key={`sig-edit-${id}`} />;
            }}
          />
          {/* NB : sans <Switch>, les routes exactes qui se chevauchent (ici
              /nouveau et /:id) se montent TOUTES LES DEUX. Le garde ci-dessous
              empêche la page détail de s'empiler derrière « Nouveau signalement »
              (et son GET /signalements/nouveau → 403 « introuvable »). */}
          <Route
            path="/tab/signalements/:id"
            exact
            render={({ match }) => {
              const { id } = match.params as { id: string };
              if (id === 'nouveau' || id === 'modifier') return null;
              return <SignalementDetail key={id} />;
            }}
          />
          <Route path="/tab/descente-terrain" component={DescenteTerrainList} exact />
          <Route path="/tab/descente-terrain/nouveau" component={DescenteTerrainCreate} exact />
          <Route
            path="/tab/descente-terrain/modifier/:id"
            exact
            render={({ match }) => {
              const { id } = match.params as { id: string };
              return <DescenteTerrainCreate key={`dt-edit-${id}`} />;
            }}
          />
          <Route
            path="/tab/descente-terrain/:id"
            exact
            render={({ match }) => {
              const { id } = match.params as { id: string };
              if (id === 'nouveau' || id === 'modifier') return null;
              return <DescenteTerrainDetail key={id} />;
            }}
          />
          <Route path="/tab/settings" component={Settings} exact />
        </Suspense>
        <Route path="/tab" render={() => <Redirect to="/tab/dashboard" />} exact />
      </IonRouterOutlet>

      <IonTabBar slot="bottom">
        <IonTabButton tab="dashboard" href="/tab/dashboard">
          <IonIcon icon={home} />
          <IonLabel>Accueil</IonLabel>
        </IonTabButton>
        <IonTabButton tab="signalements" href="/tab/signalements">
          <IonIcon icon={megaphone} />
          <IonLabel>Signalements</IonLabel>
        </IonTabButton>
        <IonTabButton tab="descente-terrain" href="/tab/descente-terrain">
          <IonIcon icon={clipboardOutline} />
          <IonLabel>Descente</IonLabel>
        </IonTabButton>
        <IonTabButton tab="settings" href="/tab/settings">
          <IonIcon icon={settings} />
          <IonLabel>Profil</IonLabel>
        </IonTabButton>
      </IonTabBar>
    </IonTabs>
  );
}
