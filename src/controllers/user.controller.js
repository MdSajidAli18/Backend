import { asyncHandler } from "../utils/asyncHandler.js";

import {ApiError} from "../utils/ApiError.js";

import {User} from "../models/user.model.js";

import {uploadOnCloudinary} from "../utils/cloudinary.js";

import {ApiResponse} from "../utils/ApiResponse.js";

import jwt from "jsonwebtoken";

import mongoose from "mongoose";


const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId) // Finding in mongoDB database
        const accessToken = user.generateAccessToken()
        const refreshToken = user.generateRefreshToken()

        user.refreshToken = refreshToken //This line of code update the refreshToken field of a user object.
        await user.save({validateBeforeSave: false}) //This line of code save the Refresh token to the database.

        return {accessToken, refreshToken}

    } catch (error) {
        throw new ApiError(500, "Something went wrong while generating refresh and access token")
    }
}



const registerUser = asyncHandler( async (req, res) => {
    //<-- We will do this step by step: -->

    // (a) get user details from the frontend
    // (b) details validation- whether the details are given or not by the user
    // (c) check if user already exists. (Check with the help of username or email)
    // (d) check for images, check for avatar
    // (e) upload images and avatar to Cloudinary. (For upload confirmation check avatar)
    // (f) create user object  - create entry in db
    // (g) remove pasword and refresh token field from response
    // (h) check for user creation
    // (i) return res

    // (a)
    const {fullName, email, username, password} = req.body
    //console.log("email: ", email);

    // (b)
    if(
        [fullName, email, username, password].some((field) => field?.trim() === "")
    ){
        throw new ApiError(400, "All fields are required")
    }


    // (c)
    const existedUser = await User.findOne({ $or:[{username}, {email}] })

    if(existedUser){
        throw new ApiError(409, "User with email or username already exists")
    }

    //console.log(req.files)


    // (d)
    const avatarLocalPath =  req.files?.avatar[0]?.path;
    //const coverImageLocalPath =  req.files?.coverImage[0]?.path;
    let coverImageLocalPath;
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0){
        coverImageLocalPath = req.files.coverImage[0].path
    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar file is required")
    }


    // (e)
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if (!avatar) {
        throw new ApiError(400, "Avatar file is required")
    }


    // (f)
    const user = await User.create({
        fullName,
        avatar: avatar.url,
        coverImage: coverImage?.url || "",
        email,
        password,
        username: username.toLowerCase()
    })


    // (g)
    const createdUser = await User.findById(user._id).select( " -password -refreshToken " )
    // (h)
    if(!createdUser){
        throw new ApiError(500, "Something went wrong while registering the user")
    }


    //(i)
    return res.status(201).json(
        new ApiResponse(200, createdUser, "User registered Successfully")
    )

})



const loginUser = asyncHandler( async (req, res) => {
    //We will do this step by step:-

    //(a) Fetch the user's data from the request(req) body.
    //(b) Check if the user's data fetched from the request body contains a username or email or not.
    //(c) Find user.(Based on the fetched data, check if the user exists or not.)
    //(d) If the user is found, then check their password.
    //(e) If the password is correct, then I will generate an Access token and Refresh token.
    //(f) After generating the Access token and Refresh token, send them to the user in the form of cookies.

    //(a)
    const {email, username, password} = req.body

    //(b)
    if(!username && !email){
        throw new ApiError(400, "username or email is required")
    }


    //(c)
    const user = await User.findOne({
        $or: [{username}, {email}] //Check either by username or by email.
    })

    if(!user){
        throw new ApiError(404, "User does not exist")
    }


    //(d)
    const isPasswordValid = await user.isPasswordCorrect(password)

    if(!isPasswordValid){
        throw new ApiError(401, "Invalid user credentials")
    }


    //(e)
    const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)


    //(f)
    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken, refreshToken
            },
            "User logged In Successfully"
        )
    )

})



const logoutUser = asyncHandler(async(req, res) => {
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set: {
                refreshToken: undefined
            }
        },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true
    }

    return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiResponse(200, {}, "User logged out"))
})



const refreshAccessToken = asyncHandler(async(req, res) => {

    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken

    if(!incomingRefreshToken){
        throw new ApiError(401, "unauthorized request")
    }

    try {
        
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)

        const user = await User.findById(decodedToken?._id)

        if(!user){
            throw new ApiError(401, "Invalid refresh token")
        }

        if(incomingRefreshToken !== user?.refreshToken){
            throw new ApiError(401, "refresh token is expired or used")
        }

        const options = {
            httpOnly: true,
            secure: true
        }

        const {accessToken, newRefreshToken} = await generateAccessAndRefreshTokens(user._id)

        return res
        .status(200)
        .cookie("accessToken", accessToken, options)
        .cookie("refreshToken", newRefreshToken, options)
        .json(
            new ApiResponse(
                200,
                {accessToken, refreshToken: newRefreshToken},
                "Access token refreshed"
            )
        )

    } catch (error) {
        throw new ApiError(401, error?.message || "Invalid refresh token")   
    }

    
})



const changeCurrentPassword = asyncHandler(async(req, res) => {
    
    const {oldPassword, newPassword} = req.body


    const user = await User.findById(req.user?._id)

    const isPasswordCorrect = await user.isPasswordCorrect(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400, "Invalid old password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    return res
    .status(200)
    .json(new ApiResponse(200, {}, "Password changed successfully"))

})



const getCurrentUser = asyncHandler(async(req, res) => {

    return res
    .status(200)
    .json(new ApiResponse(200, req.user, "current user fetched successfully"))
})



const updateAccountDetails = asyncHandler(async(req, res) => {

    const {fullName, email} = req.body

    if(!fullName || !email){
        throw new ApiError(400, "All fields are required")
    }

    const user = await User.findByIdAndUpdate(

        req.user?._id,
        {
            $set: {
                fullName,
                email: email
            }
        },
        {new: true}

    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"))

})



const updateUserAvatar = asyncHandler(async(req, res) => {
    
    const avatarLocalPath = req.file?.path

    if(!avatarLocalPath){
        throw new ApiError(400, "Avatar file is missing")
    }

    const avatar = await uploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400, "Error while uploading on avatar")
    }


    const user = await User.findByIdAndUpdate(

        req.user?._id,
        {
            $set: {
                avatar: avatar.url
            }
        },
        {new: true}

    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully") )


})


const updateUserCoverImage = asyncHandler(async(req, res) => {
    
    const coverImageLocalPath = req.file?.path

    if(!coverImageLocalPath){
        throw new ApiError(400, "Cover image file is missing")
    }

    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400, "Error while uploading on cover image")
    }


    const user = await User.findByIdAndUpdate(

        req.user?._id,
        {
            $set: {
                coverImage: coverImage.url
            }
        },
        {new: true}

    ).select("-password")

    return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated successfully") )

})



const getUserChannelProfile = asyncHandler(async(req, res) => {

    const {username} = req.params

    if(!username){
        throw new ApiError(400, "Username is missing")
    }

    const channel = await User.aggregate([

        {
            $match: {
                username: username?.toLowerCase()
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCount: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {$in: [req.user?._id, "$subscribers.subscriber"]},
                        then: true,
                        else: false
                    }
                }
            }
        },
        {
            $project: {
                fullName: 1,
                username: 1,
                subscribersCount: 1,
                channelsSubscribedToCount: 1,
                isSubscribed: 1,
                avatar: 1,
                coverImage: 1,
                email: 1
            }
        }

    ])

    if(!channel?.length){
        throw new ApiError(404, "channel does not exists")
    }

    return res
    .status(200)
    .json(new ApiResponse(200, channel[0], "User channel fetched successfully"))

})



const getWatchHistory = asyncHandler(async(req, res) => {

    const user = await User.aggregate([

        {
            $match: {
                _id: new mongoose.Types.ObjectId(req.user._id)
            }
        },
        {
            $lookup: {
                from: "videos",
                localField: "watchHistory",
                foreignField: "_id",
                as: "watchHistory",
                pipeline: [
                    {
                        $lookup: {
                            from: "users",
                            localField: "owner",
                            foreignField: "_id",
                            as: "owner",
                            pipeline: [
                                {
                                    $project: {
                                        fullName: 1,
                                        username: 1,
                                        avatar: 1
                                    }
                                }
                            ]
                        }
                    },
                    {
                        $addFields: {
                            owner: {
                                $first: "$owner"
                            }
                        }
                    }
                ]
            }
        }

    ])

    return res
    .status(200)
    .json(new ApiResponse(200, user[0].watchHistory, "Watch history fetched successfully"))

})


export {
    registerUser,
    loginUser, 
    logoutUser, 
    refreshAccessToken,
    changeCurrentPassword,
    getCurrentUser,
    updateAccountDetails,
    updateUserAvatar,
    updateUserCoverImage,
    getUserChannelProfile,
    getWatchHistory
}