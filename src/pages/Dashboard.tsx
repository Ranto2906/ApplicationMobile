import { IonPage, IonContent, IonHeader, IonToolbar, IonTitle, IonCard, IonCardContent, IonLabel, IonButton, IonIcon } from '@ionic/react';
import { people, list, shieldCheckmark, logOut } from 'ionicons/icons';
import { useAuth } from '../context/AuthContext';
import { useHistory } from 'react-router-dom';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const history = useHistory();

  const handleLogout = async () => {
    await logout();
    history.replace('/login');
  };

  const cards = [
    { icon: people, label: 'Utilisateurs', color: '#1a56db', tab: '/tab/utilisateurs' },
    { icon: list, label: 'Journal', color: '#10b981', tab: '/tab/journal' },
    { icon: shieldCheckmark, label: 'Rôles & Permissions', color: '#8b5cf6', tab: '/tab/settings' },
  ];

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#1a56db', '--color': 'white' }}>
          <IonTitle>🏛️ SEIMAD</IonTitle>
        </IonToolbar>
      </IonHeader>
      <IonContent className="ion-padding">
        {/* Welcome */}
        <IonCard style={{ '--background': 'linear-gradient(135deg, #1a56db, #3b82f6)', borderRadius: 16 }}>
          <IonCardContent style={{ color: 'white' }}>
            <h2 style={{ margin: 0, fontSize: 20, fontWeight: 'bold' }}>
              Bonjour, {user?.nomComplet || user?.nomUtilisateur} 👋
            </h2>
            <p style={{ margin: '4px 0 0', opacity: 0.85, fontSize: 13 }}>
              {user?.roles?.map((r) => r.nomRole).join(' • ') || 'Utilisateur'}
            </p>
          </IonCardContent>
        </IonCard>

        {/* Accès rapides */}
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: '16px 0 8px', color: '#374151' }}>
          Accès rapides
        </h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {cards.map((card) => (
            <IonCard
              key={card.label}
              button
              onClick={() => history.push(card.tab)}
              style={{ borderRadius: 12, margin: 0, cursor: 'pointer' }}
            >
              <IonCardContent style={{ textAlign: 'center', padding: 20 }}>
                <div style={{
                  width: 48, height: 48, borderRadius: 12, margin: '0 auto 8px',
                  background: `${card.color}15`, display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <IonIcon icon={card.icon} style={{ fontSize: 24, color: card.color }} />
                </div>
                <IonLabel style={{ fontSize: 13, fontWeight: 600 }}>{card.label}</IonLabel>
              </IonCardContent>
            </IonCard>
          ))}
        </div>

        {/* Logout */}
        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={handleLogout}
          style={{ marginTop: 24, '--border-radius': '10px' }}
        >
          <IonIcon icon={logOut} slot="start" />
          Déconnexion
        </IonButton>
      </IonContent>
    </IonPage>
  );
}
