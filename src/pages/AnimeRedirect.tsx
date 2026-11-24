import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

/** Keeps old bookmarks working after the separate anime catalogue is retired. */
const AnimeRedirect: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    navigate('/tv-shows', { replace: true });
  }, [navigate]);

  return <main className="min-h-screen bg-black" aria-label="Redirection vers les séries" />;
};

export default AnimeRedirect;
