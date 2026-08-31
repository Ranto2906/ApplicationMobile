import { useState, useEffect, useCallback } from 'react';
import {
  IonPage, IonContent, IonHeader, IonToolbar, IonTitle,
  IonList, IonItem, IonLabel, IonNote, IonBadge,
  IonSpinner, IonRefresher, IonRefresherContent, IonSegment, IonSegmentButton,
} from '@ionic/react';
import { useAuth } from '../context/AuthContext';
import { adminApi } from '../services/api';
import type { JournalConnexionDTO, PageResponse } from '../types';

export default function Journal() {
  const { user: currentUser } = useAuth();
  const isAdmin = currentUser?.roles?.some((r) => r.nomRole === 'Administrateur');

  const [entries, setEntries] = useState<JournalConnexionDTO[]>([]);
  const [page, setPage] = useState<PageResponse<JournalConnexionDTO> | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const loadJournal = useCallback(async () => {
    setLoading(true);
    try {
      const data = await adminApi.journal(currentPage, 30);
      let filtered = data.content;
      if (filter === 'success') filtered = data.content.filter((j) => j.succes);
      if (filter === 'failure') filtered = data.content.filter((j) => !j.succes);
      setEntries(filtered);
      setPage({ ...data, content: filtered });
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [currentPage, filter]);

  useEffect(() => { loadJournal(); }, [loadJournal]);

  const handleRefresh = async (e: CustomEvent) => {
    await loadJournal();
    (e.target as HTMLIonRefresherElement).complete();
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

  const successCount = entries.filter((j) => j.succes).length;
  const failureCount = entries.filter((j) => !j.succes).length;

  return (
    <IonPage>
      <IonHeader>
        <IonToolbar style={{ '--background': '#1a56db', '--color': 'white' }}>
          <IonTitle>📋 Journal</IonTitle>
        </IonToolbar>
        <IonToolbar>
          <IonSegment value={filter} onIonChange={(e) => { setFilter(e.detail.value as string); setCurrentPage(0); }}>
            <IonSegmentButton value="all">
              <IonLabel>Tous ({page?.totalElements ?? 0})</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="success">
              <IonLabel>✅ {successCount}</IonLabel>
            </IonSegmentButton>
            <IonSegmentButton value="failure">
              <IonLabel>❌ {failureCount}</IonLabel>
            </IonSegmentButton>
          </IonSegment>
        </IonToolbar>
      </IonHeader>

      <IonContent>
        <IonRefresher slot="fixed" onIonRefresh={handleRefresh}>
          <IonRefresherContent />
        </IonRefresher>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <IonSpinner name="crescent" />
          </div>
        ) : entries.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#9ca3af' }}>
            <p>Aucune entrée</p>
          </div>
        ) : (
          <IonList>
            {entries.map((entry) => (
              <IonItem key={entry.idJournal} lines="full" style={{ '--min-height': '56px' }}>
                <div slot="start" style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: entry.succes ? '#d1fae5' : '#fee2e2',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginRight: 12, fontSize: 14, fontWeight: 'bold',
                  color: entry.succes ? '#059669' : '#dc2626',
                }}>
                  {entry.nomUtilisateur?.charAt(0).toUpperCase() || '?'}
                </div>

                <IonLabel>
                  <h2 style={{ fontWeight: 600, fontSize: 14 }}>{entry.nomUtilisateur || 'Inconnu'}</h2>
                  <p style={{ fontSize: 11, color: '#6b7280' }}>
                    {entry.ipAdresse || '—'}
                  </p>
                </IonLabel>

                <IonNote slot="end" style={{ textAlign: 'right' }}>
                  <IonBadge color={entry.succes ? 'success' : 'danger'} style={{ fontSize: 10 }}>
                    {entry.succes ? 'Succès' : 'Échec'}
                  </IonBadge>
                  <p style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                    {entry.dateConnexion
                      ? new Date(entry.dateConnexion).toLocaleString('fr-FR', {
                          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                        })
                      : '—'}
                  </p>
                </IonNote>
              </IonItem>
            ))}
          </IonList>
        )}

        {/* Pagination */}
        {page && page.totalPages > 1 && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, padding: 16 }}>
            <button
              disabled={page.first}
              onClick={() => setCurrentPage((p) => p - 1)}
              style={{
                padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 8,
                background: 'white', fontSize: 13, cursor: 'pointer',
                opacity: page.first ? 0.4 : 1,
              }}
            >
              ← Préc.
            </button>
            <span style={{ padding: '8px 12px', fontSize: 12, color: '#6b7280' }}>
              {page.number + 1}/{page.totalPages}
            </span>
            <button
              disabled={page.last}
              onClick={() => setCurrentPage((p) => p + 1)}
              style={{
                padding: '8px 16px', border: '1px solid #d1d5db', borderRadius: 8,
                background: 'white', fontSize: 13, cursor: 'pointer',
                opacity: page.last ? 0.4 : 1,
              }}
            >
              Suiv. →
            </button>
          </div>
        )}
      </IonContent>
    </IonPage>
  );
}
