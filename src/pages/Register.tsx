import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const Register = () => {
  const [form, setForm] = useState({ firstName: "", lastName: "", email: "", password: "" });
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    await axios.post("http://localhost:5000/api/v1/users/register", form);
    navigate("/login");
  };

  return (
    <div className="flex flex-col gap-2 max-w-md mx-auto mt-20">
      <input name="firstName" placeholder="First Name" className="p-2 border" onChange={handleChange} />
      <input name="lastName" placeholder="Last Name" className="p-2 border" onChange={handleChange} />
      <input name="email" placeholder="Email" className="p-2 border" onChange={handleChange} />
      <input type="password" name="password" placeholder="Password" className="p-2 border" onChange={handleChange} />
      <button onClick={handleSubmit} className="bg-blue-500 text-white p-2">Register</button>

      <p>You have already account? please <a href="http://localhost:5173/login">Login</a></p>
    </div>
  );
};

export default Register;