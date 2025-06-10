import { supabase } from './supabaseAuth';

export const checkAccess = async (email: string): Promise<boolean> => {
  try {
    const { data, error } = await supabase
      .from('allowed_users')
      .select('email')
      .eq('email', email)
      .single();

    if (error) {
      console.error('Error checking access:', error);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Error in checkAccess:', error);
    return false;
  }
};

export const addAllowedUser = async (email: string): Promise<{ success: boolean; message: string }> => {
  try {
    // First check if email already exists
    const { data: existingUser } = await supabase
      .from('allowed_users')
      .select('email')
      .eq('email', email)
      .single();

    if (existingUser) {
      return { success: false, message: 'Email already in allowed list' };
    }

    // Insert new email
    const { error } = await supabase
      .from('allowed_users')
      .insert({ email });

    if (error) {
      console.error('Error adding allowed user:', error);
      return { success: false, message: 'Failed to add allowed user' };
    }

    return { success: true, message: 'User added to allowed list' };
  } catch (error) {
    console.error('Error in addAllowedUser:', error);
    return { success: false, message: 'An error occurred while adding user' };
  }
};

export const removeAllowedUser = async (email: string): Promise<{ success: boolean; message: string }> => {
  try {
    // First check if email exists
    const { data: existingUser } = await supabase
      .from('allowed_users')
      .select('email')
      .eq('email', email)
      .single();

    if (!existingUser) {
      return { success: false, message: 'Email not found in allowed list' };
    }

    // Delete email
    const { error } = await supabase
      .from('allowed_users')
      .delete()
      .eq('email', email);

    if (error) {
      console.error('Error removing allowed user:', error);
      return { success: false, message: 'Failed to remove allowed user' };
    }

    return { success: true, message: 'User removed from allowed list' };
  } catch (error) {
    console.error('Error in removeAllowedUser:', error);
    return { success: false, message: 'An error occurred while removing user' };
  }
}; 