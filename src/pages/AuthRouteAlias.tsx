import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { authPath, type AuthMode } from '../lib/authRouting.js';

/** Keeps old /auth and /auth/:app links working while exposing canonical URLs. */
const AuthRouteAlias: React.FC<{ mode?: AuthMode }> = ({ mode = 'signin' }) => {
  const location = useLocation();
  const { app } = useParams();
  return (
    <Navigate
      to={authPath(mode, location.search, app)}
      state={location.state}
      replace
    />
  );
};

export default AuthRouteAlias;
