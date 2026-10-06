import { LoginView } from "@/components/login-view";
import { useAuth } from "@/auth/auth-context";

export default function LoginScreen() {
  const { signIn } = useAuth();
  return <LoginView onSubmit={signIn} />;
}
