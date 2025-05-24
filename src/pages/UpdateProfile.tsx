import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { FiEdit2, FiCamera, FiX, FiCheck } from "react-icons/fi";

const Profile = () => {
  const [userData, setUserData] = useState({
    firstName: "",
    lastName: "",
    email: "",
    profileImage: "",
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showImagePopup, setShowImagePopup] = useState(false);
  const [isEditing, setIsEditing] = useState(false);

  const currentUser = JSON.parse(localStorage.getItem("user") || "{}");

  useEffect(() => {
    if (!currentUser?.id) return;

    const fetchUser = async () => {
      try {
        const res = await axios.get(
          `http://localhost:5000/api/v1/users/${currentUser.id}`
        );
        const user = res.data.data;
        setUserData({
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          profileImage: user.profileImage || "",
        });
        setPreview(user.profileImage || null);
      } catch (error) {
        toast.error("Failed to fetch user info.");
        console.error(error);
      }
    };

    fetchUser();
  }, [currentUser.id]);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      setPreview(URL.createObjectURL(file));
      setShowImagePopup(true);
    }
  };

  const uploadImage = async () => {
    if (!imageFile) return;
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append("upload", imageFile);

      const res = await axios.post(
        "http://localhost:5000/api/v1/upload", 
        formData,
        {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        }
      );
      const imageUrl = res.data.url;

      const updateRes = await axios.put(
        `http://localhost:5000/api/v1/users/update-profile/${currentUser.id}`,
        { profileImage: imageUrl }
      );

      localStorage.setItem("user", JSON.stringify(updateRes.data.data));
      setUserData((prev) => ({ ...prev, profileImage: imageUrl }));
      setPreview(imageUrl);
      toast.success("Profile image updated successfully!");
    } catch (err) {
      console.error("Upload failed:", err);
      toast.error("Failed to upload image");
    } finally {
      setUploading(false);
      setShowImagePopup(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setUserData({ ...userData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await axios.put(
        `http://localhost:5000/api/v1/users/update-profile/${currentUser.id}`,
        userData
      );
      localStorage.setItem("user", JSON.stringify(res.data.data));
      toast.success("Profile updated successfully!");
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to update profile:", err);
      toast.error("Error updating profile");
    }
  };

  return (
    <div className="min-h-screen bg-[#f0f2f5] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md rounded-lg shadow-md overflow-hidden">
        {/* Header */}
        <div className="bg-[#25D366] p-4 text-white">
          <h1 className="text-xl font-semibold text-center">Profile</h1>
        </div>

        {/* Profile Picture Section */}
        <div className="p-6 flex flex-col items-center">
          <div className="relative group">
            {preview ? (
              <img
                src={preview}
                alt="Profile"
                className="w-32 h-32 rounded-full object-cover border-4 border-white shadow-lg"
              />
            ) : (
              <div className="w-32 h-32 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-4xl font-bold">
                {userData.firstName.charAt(0).toUpperCase()}
              </div>
            )}
            <label className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-md cursor-pointer hover:bg-gray-100 transition">
              <FiCamera  />
              <input
                type="file"
                accept="image/*"
                onChange={handleImageChange}
                className="hidden"
              />
            </label>
          </div>

          <h2 className="mt-4 text-xl font-semibold text-gray-800">
            {userData.firstName} {userData.lastName}
          </h2>
          <p className="text-gray-600">{userData.email}</p>
        </div>

        {/* Profile Info Section */}
        <div className="px-6 pb-6">
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-lg font-medium text-gray-800">Account Info</h3>
            {!isEditing ? (
              <button
                onClick={() => setIsEditing(true)}
                className="text-[#25D366] hover:text-[#128C7E] flex items-center gap-1"
              >
                <FiEdit2 size={16} /> Edit
              </button>
            ) : (
              <button
                onClick={() => setIsEditing(false)}
                className="text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <FiX size={16} /> Cancel
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  First Name
                </label>
                <input
                  type="text"
                  name="firstName"
                  value={userData.firstName}
                  onChange={handleChange}
                  disabled={!isEditing}
                  className={`w-full p-3 border rounded-lg ${
                    isEditing
                      ? "focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      : "bg-gray-100 cursor-not-allowed"
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Last Name
                </label>
                <input
                  type="text"
                  name="lastName"
                  value={userData.lastName}
                  onChange={handleChange}
                  disabled={!isEditing}
                  className={`w-full p-3 border rounded-lg ${
                    isEditing
                      ? "focus:ring-2 focus:ring-green-500 focus:border-transparent"
                      : "bg-gray-100 cursor-not-allowed"
                  }`}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={userData.email}
                  readOnly
                  className="w-full p-3 border rounded-lg bg-gray-100 cursor-not-allowed"
                />
              </div>

              {isEditing && (
                <button
                  type="submit"
                  className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white font-semibold py-3 rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                  <FiCheck size={18} /> Save Changes
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {/* Image Upload Preview Popup */}
      {showImagePopup && preview && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm overflow-hidden">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold text-gray-800">
                Update Profile Picture
              </h2>
            </div>
            <div className="p-6 flex flex-col items-center">
              <img
                src={preview}
                alt="Preview"
                className="w-40 h-40 rounded-full object-cover mb-6 border-4 border-white shadow-md"
              />
              <div className="flex gap-3 w-full">
                <button
                  onClick={() => {
                    setShowImagePopup(false);
                    setPreview(userData.profileImage || null);
                  }}
                  className="flex-1 py-2 bg-gray-200 hover:bg-gray-300 text-gray-800 rounded-lg font-medium transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={uploadImage}
                  disabled={uploading}
                  className="flex-1 py-2 bg-[#25D366] hover:bg-[#128C7E] text-white rounded-lg font-medium flex items-center justify-center gap-2 transition-colors"
                >
                  {uploading ? (
                    <>
                      <svg
                        className="animate-spin h-5 w-5 text-white"
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        ></circle>
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        ></path>
                      </svg>
                      Uploading...
                    </>
                  ) : (
                    "Upload"
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;