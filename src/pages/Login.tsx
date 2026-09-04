import { useState } from 'react';
import { IonPage, IonContent, IonItem, IonLabel, IonInput, IonButton, IonText, IonImg, IonSpinner } from '@ionic/react';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { config } from '../config';

export default function Login() {
  const [nomUtilisateur, setNomUtilisateur] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const history = useHistory();

  const [debug, setDebug] = useState('');

  const handleSubmit = async () => {
    setError('');
    setDebug('');
    setLoading(true);
    const url = `${config.getApiBase()}/auth/login`;
    setDebug(`→ ${url}`);
    try {
      await login({ nomUtilisateur, motDePasse });
      history.replace('/tab/dashboard');
    } catch (err: any) {
      const details = err?.response?.status
        ? `HTTP ${err?.response?.status}: ${JSON.stringify(err?.response?.data).slice(0,200)}`
        : `${err?.code || 'UNKNOWN'}: ${err?.message || 'no message'}`;
      setDebug(`→ ${url}\n${details}`);
      if (err?.code === 'ERR_NETWORK' || err?.message?.includes('Network Error')) {
        setError('Impossible de contacter le serveur. Vérifiez votre connexion WiFi et l\'adresse du serveur.');
      } else if (err?.response?.status === 401) {
        setError('Identifiant ou mot de passe incorrect');
      } else if (err?.response?.status === 403) {
        setError('Accès refusé. Vérifiez la configuration CORS du serveur.');
      } else if (err?.response?.status >= 500) {
        setError('Erreur serveur. Réessayez plus tard.');
      } else {
        setError('Identifiant ou mot de passe incorrect');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <IonPage>
      <IonContent className="ion-padding" style={{ '--background': 'linear-gradient(135deg, #1a56db 0%, #1e3a5f 100%)' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', minHeight: '100vh', padding: '20px',
        }}>
          {/* Logo */}
          <div style={{ textAlign: 'center', marginBottom: 40 }}>
            <div style={{ fontSize: 48 }}>🏛️</div>
            <h1 style={{ color: 'white', fontSize: 28, fontWeight: 'bold', margin: '8px 0 4px' }}>
              SEIMAD
            </h1>
            <p style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>
              Patrimoine Foncier
            </p>
          </div>

          {/* Formulaire */}
          <div style={{
            background: 'white', borderRadius: 16, padding: 24,
            width: '100%', maxWidth: 400, boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}>
            {error && (
              <div style={{
                background: '#fef2f2', color: '#dc2626', padding: 12,
                borderRadius: 8, fontSize: 13, marginBottom: 16, border: '1px solid #fecaca',
              }}>
                {error}
              </div>
            )}

            <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: 12 }}>
              <IonLabel position="stacked" style={{ fontSize: 13, color: '#6b7280' }}>
                Nom d'utilisateur
              </IonLabel>
              <IonInput
                value={nomUtilisateur}
                onIonInput={(e) => setNomUtilisateur(e.detail.value || '')}
                placeholder="admin"
                autocomplete="username"
              />
            </IonItem>

            <IonItem lines="none" style={{ '--background': 'transparent', marginBottom: 20 }}>
              <IonLabel position="stacked" style={{ fontSize: 13, color: '#6b7280' }}>
                Mot de passe
              </IonLabel>
              <IonInput
                type="password"
                value={motDePasse}
                onIonInput={(e) => setMotDePasse(e.detail.value || '')}
                placeholder="••••••••"
                autocomplete="current-password"
              />
            </IonItem>

            <IonButton
              expand="block"
              onClick={handleSubmit}
              disabled={loading || !nomUtilisateur || !motDePasse}
              style={{ '--border-radius': '10px', height: 48, fontWeight: 600 }}
            >
              {loading ? <IonSpinner name="crescent" /> : 'Se connecter'}
            </IonButton>

            <IonText color="medium" style={{ display: 'block', textAlign: 'center', marginTop: 16, fontSize: 12 }}>
              <p>Compte démo : admin / admin</p>
            </IonText>

            {debug && (
              <div style={{
                marginTop: 12, padding: 8, borderRadius: 6,
                background: '#f3f4f6', fontSize: 10, fontFamily: 'monospace',
                color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                {debug}
              </div>
            )}
          </div>
        </div>
      </IonContent>
    </IonPage>
  );
}
