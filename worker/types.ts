export type AppEnv = {
  Bindings: Env;
  Variables: {
    /** Owner of all rows this request may read or write. */
    ownerId: string;
    /** Admins create and share profiles; everyone else only sees profiles shared with them. */
    isAdmin: boolean;
  };
};
