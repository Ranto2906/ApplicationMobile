import { useState } from 'react';
import { IonPage, IonContent, IonItem, IonInput, IonButton, IonText, IonSpinner, IonIcon } from '@ionic/react';
import { eye, eyeOff, personOutline, lockClosedOutline, locationOutline } from 'ionicons/icons';
import { useHistory } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../hooks/useOnline';
import { config } from '../config';
import logoSeimad from '../assets/logoseimad.jpg';
import './Login.css';

export default function Login() {
  const [nomUtilisateur, setNomUtilisateur] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const { login, loginHorsLigne } = useAuth();
  const history = useHistory();
  const online = useOnline();

  const [debug, setDebug] = useState('');

  const handleSubmit = async () => {
    setError('');
    setDebug('');
    setLoading(true);
    const url = `${config.getApiBase()}/auth/login`;
    setDebug(`→ ${url}`);
    console.log(`[SEIMAD:Login] submit → ${url} (depuis démarrage: ${Math.round(performance.now() - (window as any).__SEIMAD_DÉMARAGE__ || 0)}ms)`);
    try {
      if (!online) {
        // Hors-ligne : vérification locale (session enregistrée lors d'une
        // précédente connexion en ligne).
        setDebug('→ Mode hors-ligne : vérification locale des identifiants');
        await loginHorsLigne({ nomUtilisateur, motDePasse });
      } else {
        await login({ nomUtilisateur, motDePasse });
      }
      history.replace('/tab/dashboard');
    } catch (err: any) {
      const details = err?.response?.status
        ? `HTTP ${err?.response?.status}: ${JSON.stringify(err?.response?.data).slice(0, 200)}`
        : `${err?.code || 'UNKNOWN'}: ${err?.message || 'no message'}`;
      setDebug(`→ ${url}\n${details}`);
      if (err?.code === 'OFFLINE_AUTH') {
        setError(err?.message || 'Connexion hors-ligne impossible');
      } else if (err?.code === 'ERR_NETWORK' || err?.message?.includes('Network Error')) {
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
      <IonContent className="login-content">
        <header className="login-topbar">
          <img className="login-topbar-logo" src={logoSeimad} alt="" aria-hidden="true" />
          <span className="login-topbar-name">SEIMAD</span>
        </header>

        <main className="login-shell">
          <section className="login-card" aria-labelledby="login-title">
            <h1 id="login-title" className="login-card-heading">Se connecter</h1>
            <p className="login-card-sub">
              Accédez à votre espace de gestion<br />du patrimoine foncier
            </p>

            {error && (
              <div className="login-error" role="alert">
                {error}
              </div>
            )}

            <form
              className="login-form"
              onSubmit={(event) => { event.preventDefault(); void handleSubmit(); }}
            >
              <IonItem lines="none" className="login-field">
                <IonIcon icon={personOutline} slot="start" aria-hidden="true" />
                <IonInput
                  value={nomUtilisateur}
                  onIonInput={(e) => setNomUtilisateur(e.detail.value || '')}
                  placeholder="Nom d'utilisateur"
                  autocomplete="username"
                  inputmode="email"
                  aria-label="Nom d'utilisateur"
                />
              </IonItem>

              <IonItem lines="none" className="login-field">
                <IonIcon icon={lockClosedOutline} slot="start" aria-hidden="true" />
                <IonInput
                  value={motDePasse}
                  onIonInput={(e) => setMotDePasse(e.detail.value || '')}
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Mot de passe"
                  autocomplete="current-password"
                  aria-label="Mot de passe"
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                  onClick={() => setShowPassword((visible) => !visible)}
                >
                  <IonIcon icon={showPassword ? eyeOff : eye} aria-hidden="true" />
                </button>
              </IonItem>

              <IonButton
                type="submit"
                expand="block"
                disabled={loading || !nomUtilisateur || !motDePasse}
                className="login-submit"
              >
                {loading ? <IonSpinner name="crescent" /> : 'Se connecter'}
              </IonButton>
            </form>

            <hr className="login-divider" />

            <p className="login-section-label">ACCÈS TERRAIN</p>

            {!online && (
              <div className="login-offline" role="status">
                <IonIcon icon={locationOutline} aria-hidden="true" />
                <span>
                  <strong>Mode hors ligne</strong>
                  Vous pourrez travailler sur le terrain sans connexion Internet après synchronisation.
                </span>
              </div>
            )}

            {online && (
              <div className="login-offline login-online" role="status">
                <IonIcon icon={locationOutline} aria-hidden="true" />
                <span>
                  <strong>Accès terrain disponible</strong>
                  Synchronisez vos données avant de partir.
                </span>
              </div>
            )}

            <IonText className="login-demo">
              <p>Compte démo : <strong>admin / admin</strong></p>
            </IonText>

            {debug && (
              <details className="login-debug">
                <summary>Informations techniques</summary>
                <div>{debug}</div>
              </details>
            )}
          </section>

          <footer className="login-footer">
            <strong>SEIMAD</strong> · Système de gestion du patrimoine foncier<br />
            Application mobile
          </footer>
        </main>
      </IonContent>
    </IonPage>
  );
}