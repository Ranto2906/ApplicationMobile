import { useState } from 'react';
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonTitle,
  IonCard, IonCardContent, IonItem, IonLabel, IonList,
  IonListHeader, IonNote, IonButton, IonIcon, IonAlert,
  IonToast, IonInput, IonAvatar, IonBadge,
} from '@ionic/react';
import { person, shieldCheckmark, logOut, key, refresh } from 'ionicons/icons';
import { useAuth } from '../context/AuthContext';
import { useHistory } from 'react-router-dom';
import { authApi } from '../services/api';

export default function Settings() {
  const { user, logout } = useAuth();
  const history = useHistory();
  const [showChangePwd, setShowChangePwd] = useState(false);
  const [oldPwd, setOldPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [toastMsg, setToastMsg] = useState('');
  const [toastColor, setToastColor] = useState('success');

  const handleLogout = async () => {
    await logout();
    history.replace('/login');
  };

  const handleChangePassword = async () => {
    if (!oldPwd || !newPwd || newPwd.length < 6) return;
    try {
      await authApi.changePassword({ ancienMotDePasse: oldPwd, nouveauMotDePasse: newPwd });
      setToastMsg('Mot de passe changé');
      setToastColor('success');
      setShowChangePwd(false);
      setOldPwd(''); setNewPwd('');
    } catch (err: unknown) {
      setToastMsg(err instanceof Error ? err.message : 'Erreur');
      setToastColor('danger');
    }
  };

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#1a56db', '--color': 'white' }}>
          <IonTitle>👤 Mon profil</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent className="ion-padding">
        {/* Avatar & Info */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{
            width: 72, height: 72, borderRadius: '50%', background: '#dbeafe',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 12px', fontSize: 28, fontWeight: 'bold', color: '#1a56db',
          }}>
            {user?.nomUtilisateur?.charAt(0).toUpperCase()}
          </div>
          <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>{user?.nomComplet || user?.nomUtilisateur}</h2>
          <p style={{ margin: '4px 0', color: '#6b7280', fontSize: 14 }}>{user?.email || '—'}</p>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 8, flexWrap: 'wrap' }}>
            {user?.roles?.map((r) => (
              <IonBadge key={r.idRole} color="primary" style={{ fontSize: 11 }}>{r.nomRole}</IonBadge>
            ))}
          </div>
        </div>

        {/* Info compte */}
        <IonCard style={{ borderRadius: 12 }}>
          <IonListHeader>
            <IonLabel style={{ fontWeight: 600, fontSize: 14, color: '#374151' }}>Informations</IonLabel>
          </IonListHeader>
          <IonList>
            <IonItem lines="none">
              <IonIcon icon={person} slot="start" color="primary" />
              <IonLabel>
                <p style={{ fontSize: 12, color: '#6b7280' }}>Nom d'utilisateur</p>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>{user?.nomUtilisateur}</h3>
              </IonLabel>
            </IonItem>
            <IonItem lines="none">
              <IonIcon icon={shieldCheckmark} slot="start" color="primary" />
              <IonLabel>
                <p style={{ fontSize: 12, color: '#6b7280' }}>Statut</p>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>
                  <IonBadge color={user?.actif ? 'success' : 'danger'} style={{ fontSize: 11 }}>
                    {user?.actif ? 'Actif' : 'Inactif'}
                  </IonBadge>
                </h3>
              </IonLabel>
            </IonItem>
            <IonItem lines="none">
              <IonIcon icon={refresh} slot="start" color="primary" />
              <IonLabel>
                <p style={{ fontSize: 12, color: '#6b7280' }}>Dernière connexion</p>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>
                  {user?.derniereConnexion
                    ? new Date(user.derniereConnexion).toLocaleString('fr-FR')
                    : 'Jamais'}
                </h3>
              </IonLabel>
            </IonItem>
          </IonList>
        </IonCard>

        {/* Actions */}
       

        {/* Logout */}
        <IonButton
          expand="block"
          fill="outline"
          color="danger"
          onClick={handleLogout}
          style={{ marginTop: 16, '--border-radius': '10px' }}
        >
          <IonIcon icon={logOut} slot="start" />
          Déconnexion
        </IonButton>

        {/* Modal changement mot de passe */}
        <IonAlert
          isOpen={showChangePwd}
          header="Changer le mot de passe"
          inputs={[
            { name: 'old', type: 'password', placeholder: 'Mot de passe actuel' },
            { name: 'new', type: 'password', placeholder: 'Nouveau mot de passe (min. 6)' },
          ]}
          buttons={[
            { text: 'Annuler', role: 'cancel' },
            {
              text: 'Changer',
              handler: async (data) => {
                setOldPwd(data.old);
                setNewPwd(data.new);
                // Hack:直接调用
                if (data.old && data.new && data.new.length >= 6) {
                  try {
                    await authApi.changePassword({ ancienMotDePasse: data.old, nouveauMotDePasse: data.new });
                    setToastMsg('Mot de passe changé');
                    setToastColor('success');
                  } catch (err: unknown) {
                    setToastMsg(err instanceof Error ? err.message : 'Erreur');
                    setToastColor('danger');
                  }
                }
              },
            },
          ]}
          onDidDismiss={() => { setShowChangePwd(false); setOldPwd(''); setNewPwd(''); }}
        />

        <IonToast
          isOpen={!!toastMsg}
          message={toastMsg}
          duration={2000}
          color={toastColor}
          onDidDismiss={() => setToastMsg('')}
        />
      </IonContent>
    </IonPage>
  );
}
