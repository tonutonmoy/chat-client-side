import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const Login = () => {
  const [form, setForm] = useState({ email: "", password: "" });
  const navigate = useNavigate();

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const handleSubmit = async () => {
    const res = await axios.post("http://localhost:5000/api/v1/auth/login", form);
    localStorage.setItem("user", JSON.stringify(res.data.data));
    navigate("/home");
  };

  return (
    <div className="flex flex-col gap-2 max-w-md mx-auto mt-20">
      <input name="email" placeholder="Email" className="p-2 border" onChange={handleChange} />
      <input type="password" name="password" placeholder="Password" className="p-2 border" onChange={handleChange} />
      <button onClick={handleSubmit} className="bg-green-500 text-white p-2">Login</button>
       <p>You new are new ? please <a href="http://localhost:5173/register">Register</a></p>
    </div>
  );
};

export default Login;