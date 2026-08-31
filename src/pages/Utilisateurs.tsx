import { useState, useEffect, useCallback } from 'react';
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonTitle,
  IonSearchbar, IonList, IonItem, IonLabel, IonNote,
  IonBadge, IonSpinner, IonRefresher, IonRefresherContent,
  IonFab, IonFabButton, IonIcon, IonAlert, IonToast,
  IonModal, IonButton, IonInput, IonSelect, IonSelectOption,
} from '@ionic/react';
import { add, person, people } from 'ionicons/icons';
import { useAuth } from '../context/AuthContext';
import { utilisateurApi, roleApi } from '../services/api';
import type { UtilisateurDTO, RoleDTO, PageResponse } from '../types';

export default function Utilisateurs() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.roles?.some((r) => r.nomRole === 'Administrateur');

  const [users, setUsers] = useState<UtilisateurDTO[]>([]);
  const [page, setPage] = useState<PageResponse<UtilisateurDTO> | null>(null);
  const [allRoles, setAllRoles] = useState<RoleDTO[]>([]);
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [toastMsg, setToastMsg] = useState('');
  const [toastColor, setToastColor] = useState('success');

  // Form create
  const [formNom, setFormNom] = useState('');
  const [formPrenom, setFormPrenom] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPwd, setFormPwd] = useState('');

  useEffect(() => { roleApi.lister().then(setAllRoles).catch(() => {}); }, []);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await utilisateurApi.lister(search || undefined, currentPage, 20);
      setUsers(data.content);
      setPage(data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [search, currentPage]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleRefresh = async (e: CustomEvent) => {
    await loadUsers();
    (e.target as HTMLIonRefresherElement).complete();
  };

  const handleCreate = async () => {
    if (!formNom.trim() || !formPwd) return;
    try {
      await utilisateurApi.creer({
        nomUtilisateur: formNom.trim(),
        nomComplet: formPrenom.trim() || undefined,
        email: formEmail.trim() || undefined,
        motDePasse: formPwd,
      });
      setToastMsg('Utilisateur créé');
      setToastColor('success');
      setShowCreate(false);
      setFormNom(''); setFormPrenom(''); setFormEmail(''); setFormPwd('');
      loadUsers();
    } catch (err: unknown) {
      setToastMsg(err instanceof Error ? err.message : 'Erreur');
      setToastColor('danger');
    }
  };

  const handleToggle = async (u: UtilisateurDTO) => {
    try {
      await utilisateurApi.activerDesactiver(u.idUtilisateur, !u.actif);
      setToastMsg(u.actif ? 'Désactivé' : 'Activé');
      setToastColor('success');
      loadUsers();
    } catch { /* ignore */ }
  };

  if (!isAdmin) {
    return (
      <IonPage>
        <IonContent className="ion-padding" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: '#dc2626', fontWeight: 600 }}>Accès réservé aux administrateurs</p>
        </IonContent>
      </IonPage>
    );
  }

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#1a56db', '--color': 'white' }}>
          <IonTitle>👥 Utilisateurs</IonTitle>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        <IonSearchbar
          value={search}
          onIonInput={(e) => { setSearch(e.detail.value || ''); setCurrentPage(0); }}
          placeholder="Rechercher..."
          debounce={300}
        />

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <IonSpinner name="crescent" />
          </div>
        ) : users.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
            <p>Aucun utilisateur trouvé</p>
          </div>
        ) : (
          <IonList>
            {users.map((u) => (
              <IonItem key={u.idUtilisateur} lines="full" detail={false}>
                <div slot="start" style={{
                  width: 40, height: 40, borderRadius: '50%',
                  background: u.actif ? '#dbeafe' : '#fee2e2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginRight: 12, fontSize: 16, fontWeight: 'bold',
                  color: u.actif ? '#1a56db' : '#dc2626',
                }}>
                  {u.nomUtilisateur?.charAt(0).toUpperCase()}
                </div>

                <IonLabel>
                  <h2 style={{ fontWeight: 600, fontSize: 15 }}>{u.nomUtilisateur}</h2>
                  <p style={{ fontSize: 12, color: '#6b7280' }}>
                    {u.nomComplet || '—'} • {u.email || '—'}
                  </p>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                    {u.roles?.map((r) => (
                      <IonBadge key={r.idRole} color="primary" style={{ fontSize: 10, fontWeight: 500 }}>
                        {r.nomRole}
                      </IonBadge>
                    ))}
                  </div>
                </IonLabel>

                <IonNote slot="end" style={{ textAlign: 'right' }}>
                  <IonBadge color={u.actif ? 'success' : 'danger'} style={{ fontSize: 10 }}>
                    {u.actif ? 'Actif' : 'Inactif'}
                  </IonBadge>
                  <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>
                    <button
                      onClick={() => handleToggle(u)}
                      style={{
                        background: 'none', border: 'none', color: '#1a56db',
                        fontSize: 11, cursor: 'pointer', padding: 0,
                      }}
                    >
                      {u.actif ? 'Désactiver' : 'Activer'}
                    </button>
                  </p>
                </IonNote>
              </IonItem>
            ))}
          </IonList>
        )}

        {/* FAB Ajouter */}
        <IonFab vertical="bottom" horizontal="end" slot="fixed" style={{ marginBottom: 60 }}>
          <IonFabButton onClick={() => setShowCreate(true)} className="fab-custom">
            <IonIcon icon={add} />
          </IonFabButton>
        </IonFab>

        {/* Modal création */}
        <IonModal isOpen={showCreate} onDidDismiss={() => setShowCreate(false)}>
          <IonHeader>
            <IonToolbar>
              <IonTitle>Nouvel utilisateur</IonTitle>
              <IonButton slot="end" onClick={() => setShowCreate(false)}>Fermer</IonButton>
            </IonToolbar>
          </IonHeader>
          <IonContent className="ion-padding">
            <IonItem>
              <IonLabel position="stacked">Nom d'utilisateur *</IonLabel>
              <IonInput value={formNom} onIonInput={(e) => setFormNom(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Nom complet</IonLabel>
              <IonInput value={formPrenom} onIonInput={(e) => setFormPrenom(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Email</IonLabel>
              <IonInput value={formEmail} onIonInput={(e) => setFormEmail(e.detail.value || '')} />
            </IonItem>
            <IonItem>
              <IonLabel position="stacked">Mot de passe *</IonLabel>
              <IonInput type="password" value={formPwd} onIonInput={(e) => setFormPwd(e.detail.value || '')} />
            </IonItem>
            <IonButton
              expand="block"
              onClick={handleCreate}
              disabled={!formNom.trim() || !formPwd}
              style={{ marginTop: 16, '--border-radius': '10px' }}
            >
              Créer l'utilisateur
            </IonButton>
          </IonContent>
        </IonModal>

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
